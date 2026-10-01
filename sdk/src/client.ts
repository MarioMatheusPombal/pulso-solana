import anchor, { AnchorError, EventParser, type IdlAccounts, type Program } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  ANCHOR_ACCOUNT_NOT_INITIALIZED,
  ApprovalDeniedError,
  ApprovalTimeoutError,
  PULSO_ERRORS,
  PulsoProgramError,
  pulsoErrorFromCode,
} from "./errors.js";
import { buildIntent, type Intent } from "./intent.js";
import {
  PROGRAM_ID,
  findIntentPda,
  findPolicyPda,
  findRecipientApprovalPda,
  findVaultPda,
  getProgram,
  type Pulso,
} from "./program.js";

// Node 22 ESM does not see BN as a named export of the CJS build; take it from the default export.
const { BN } = anchor;

export type PulsoPolicy = IdlAccounts<Pulso>["agentPolicy"];

export interface PendingApproval {
  status: "HUMAN_INTENT_REQUIRED";
  reason: "HUMAN_INTENT_REQUIRED" | "RECIPIENT_NOT_ALLOWED";
  /** The exact action to be authorized and, later, repeated. */
  intent: Intent;
  /** Hex of the action hash. */
  approvalId: string;
  /** Approval screen; undefined when no `approvalsUrl` was configured. */
  approvalUrl: string | undefined;
}

export type ExecuteResult = { status: "executed"; signature: string } | PendingApproval;

export interface PulsoClientOptions {
  connection: Connection;
  agent: Keypair;
  human: PublicKey;
  programId?: PublicKey;
  /** Base URL of the approvals backend. Without it nothing is sent anywhere (direct on-chain use). */
  approvalsUrl?: string;
  /** Optional, best-effort activity sink. Without it the SDK makes no activity requests. */
  activityUrl?: string;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface ExecuteParams {
  amount: bigint;
  /** Destination token account. */
  recipient: PublicKey;
  expiresInSeconds?: number;
  maxUses?: number;
}

export interface WaitOptions {
  timeoutMs?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  /** Injectable for tests. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const realSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Sim = { ok: true } | { ok: false; code: number; logs: string[] };

type ActivityStatus = "autonomous" | "blocked" | "approved" | "executed" | "rejected";
type ActivityEvidence = "confirmed_transaction" | "simulation" | "chain_account_observed";
interface ActivityInput {
  eventId: string;
  status: ActivityStatus;
  evidence: ActivityEvidence;
  authority: string;
  agent: string;
  programId: string;
  policy: string;
  mint?: string;
  actionHash?: string;
  amount: string;
  recipient: string;
  code?: string;
  signature?: string;
}
type ActivityDraft = Omit<ActivityInput, "eventId" | "authority" | "agent" | "programId" | "policy" | "amount" | "recipient"> & {
  amount: bigint;
  recipient: PublicKey;
};

export class PulsoClient {
  readonly connection: Connection;
  readonly agent: Keypair;
  readonly human: PublicKey;
  readonly programId: PublicKey;
  readonly policy: PublicKey;
  readonly vault: PublicKey;
  private readonly approvalsUrl?: string;
  private readonly activityUrl?: string;
  private readonly fetchFn: typeof fetch;
  private readonly program: Program<Pulso>;

  constructor(o: PulsoClientOptions) {
    this.connection = o.connection;
    this.agent = o.agent;
    this.human = o.human;
    this.programId = o.programId ?? PROGRAM_ID;
    this.approvalsUrl = o.approvalsUrl?.replace(/\/+$/, "");
    this.activityUrl = o.activityUrl?.replace(/\/+$/, "");
    this.fetchFn = o.fetch ?? fetch;
    this.policy = findPolicyPda(o.human, o.agent.publicKey, this.programId);
    this.vault = findVaultPda(this.policy, this.programId);
    this.program = getProgram(o.connection, o.agent);
  }

  /** Executes the transfer, or returns HUMAN_INTENT_REQUIRED (without throwing) when the policy asks for the human. */
  async execute(p: ExecuteParams): Promise<ExecuteResult> {
    const { amount, recipient, expiresInSeconds = 120, maxUses = 1 } = p;
    const approval = findRecipientApprovalPda(this.policy, recipient, this.programId);
    const hasApproval = (await this.connection.getAccountInfo(approval)) !== null;
    const ix = await this.transferIx(amount, recipient, new Uint8Array(16), undefined, hasApproval ? approval : undefined);
    const sim = await this.simulate(ix);
    if (sim.ok) {
      const signature = await this.send(ix);
      await this.postActivity({
        status: "autonomous", evidence: "confirmed_transaction", amount, recipient, signature,
      });
      return { status: "executed", signature };
    }

    if (sim.code !== PULSO_ERRORS.HumanIntentRequired.code && sim.code !== PULSO_ERRORS.RecipientNotAllowed.code) {
      const error = this.toError(sim);
      if (error instanceof PulsoProgramError && error.error.spec) {
        await this.postActivity({ status: "rejected", evidence: "simulation", amount, recipient, code: error.error.message });
      }
      throw error;
    }
    // Build the intent from what the program says it needs, not from the caller's arguments.
    const event = [...new EventParser(this.programId, this.program.coder).parseLogs(sim.logs)].find(
      (e) => e.name === "IntentRequired" || e.name === "intentRequired",
    );
    if (!event) throw new Error("Program returned an intent error without an IntentRequired event");
    const d = event.data as {
      human: PublicKey;
      agent: PublicKey;
      mint: PublicKey;
      recipient: PublicKey;
      amount: InstanceType<typeof BN>;
    };
    const intent = buildIntent({
      programId: this.programId,
      authority: d.human,
      agent: d.agent,
      mint: d.mint,
      amount: BigInt(d.amount.toString()),
      recipient: d.recipient,
      expiresAt: (await this.chainNow()) + BigInt(expiresInSeconds),
      maxUses,
    });
    const approvalId = hex(intent.actionHash);
    const pending: PendingApproval = {
      status: "HUMAN_INTENT_REQUIRED",
      reason: sim.code === PULSO_ERRORS.RecipientNotAllowed.code ? "RECIPIENT_NOT_ALLOWED" : "HUMAN_INTENT_REQUIRED",
      intent,
      approvalId,
      approvalUrl: this.approvalsUrl ? `${this.approvalsUrl}/approvals/${approvalId}` : undefined,
    };
    await this.postActivity({
      status: "blocked", evidence: "simulation", amount: intent.fields.amount, recipient: intent.fields.recipient,
      mint: intent.fields.mint.toBase58(),
      actionHash: pending.approvalId, code: sim.code === PULSO_ERRORS.RecipientNotAllowed.code
        ? PULSO_ERRORS.RecipientNotAllowed.message : PULSO_ERRORS.HumanIntentRequired.message,
    });
    if (this.approvalsUrl) await this.postApproval(pending, d.mint);
    return pending;
  }

  /** Resolves when the intent exists on-chain. Rejects on denial or timeout. */
  async waitForApproval(pending: PendingApproval, o: WaitOptions = {}): Promise<void> {
    const { timeoutMs = 120_000, initialDelayMs = 1_000, maxDelayMs = 8_000, sleep = realSleep, now = Date.now } = o;
    const intentPda = findIntentPda(this.human, pending.intent.actionHash, this.programId);
    const deadline = now() + timeoutMs;
    let delay = initialDelayMs;
    for (;;) {
      // On-chain is the truth.
      if ((await this.connection.getAccountInfo(intentPda)) !== null) {
        await this.postActivity({
          status: "approved", evidence: "chain_account_observed", amount: pending.intent.fields.amount,
          recipient: pending.intent.fields.recipient, actionHash: pending.approvalId, mint: pending.intent.fields.mint.toBase58(),
        });
        return;
      }
      if (this.approvalsUrl && (await this.backendStatus(pending.approvalId)) === "denied") {
        throw new ApprovalDeniedError(pending.approvalId);
      }
      const remaining = deadline - now();
      if (remaining <= 0) throw new ApprovalTimeoutError(pending.approvalId, timeoutMs);
      await sleep(Math.min(delay, remaining));
      delay = Math.min(delay * 2, maxDelayMs);
    }
  }

  /** Repeats exactly the action stored in `pending.intent`; takes nothing else on purpose. */
  async executeApproved(pending: PendingApproval): Promise<{ status: "executed"; signature: string }> {
    const { fields, nonce, actionHash } = pending.intent;
    const intentPda = findIntentPda(this.human, actionHash, this.programId);
    const ix = await this.transferIx(fields.amount, fields.recipient, nonce, intentPda);
    const sim = await this.simulate(ix);
    if (!sim.ok) {
      const error = this.toError(sim);
      if (error instanceof PulsoProgramError && error.error.spec) {
        await this.postActivity({
          status: "rejected", evidence: "simulation", amount: fields.amount, recipient: fields.recipient,
          actionHash: hex(actionHash), mint: fields.mint.toBase58(), code: error.error.message,
        });
      }
      throw error;
    }
    const signature = await this.send(ix);
    await this.postActivity({
      status: "executed", evidence: "confirmed_transaction", amount: fields.amount,
      recipient: fields.recipient, actionHash: hex(actionHash), mint: fields.mint.toBase58(), signature,
    });
    return { status: "executed", signature };
  }

  async executeAndWait(p: ExecuteParams, w?: WaitOptions): Promise<{ status: "executed"; signature: string }> {
    const r = await this.execute(p);
    if (r.status === "executed") return r;
    await this.waitForApproval(r, w);
    return this.executeApproved(r);
  }

  async getPolicy(): Promise<PulsoPolicy | null> {
    return this.program.account.agentPolicy.fetchNullable(this.policy);
  }

  private transferIx(
    amount: bigint,
    recipient: PublicKey,
    nonce: Uint8Array,
    intent?: PublicKey,
    recipientApproval?: PublicKey,
  ): Promise<TransactionInstruction> {
    return this.program.methods
      .executeTransfer(new BN(amount.toString()), Array.from(nonce))
      .accountsPartial({
        agent: this.agent.publicKey,
        policy: this.policy,
        vault: this.vault,
        recipient,
        tokenProgram: TOKEN_PROGRAM_ID,
        intent: intent ?? null,
        recipientApproval: recipientApproval ?? null,
      })
      .instruction();
  }

  private async buildTx(ix: TransactionInstruction): Promise<Transaction> {
    const tx = new Transaction().add(ix);
    tx.feePayer = this.agent.publicKey;
    tx.recentBlockhash = (await this.connection.getLatestBlockhash()).blockhash;
    tx.sign(this.agent);
    return tx;
  }

  private async simulate(ix: TransactionInstruction): Promise<Sim> {
    const { value } = await this.connection.simulateTransaction(await this.buildTx(ix));
    if (!value.err) return { ok: true };
    const logs = value.logs ?? [];
    const e = value.err as { InstructionError?: [number, { Custom?: number }] };
    const code = e.InstructionError?.[1]?.Custom;
    if (code === undefined) throw new Error(`Simulation failed: ${JSON.stringify(value.err)}\n${logs.join("\n")}`);
    return { ok: false, code, logs };
  }

  private async send(ix: TransactionInstruction): Promise<string> {
    const tx = await this.buildTx(ix);
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    const latest = await this.connection.getLatestBlockhash();
    const res = await this.connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    if (res.value.err) throw new Error(`Transaction ${sig} failed: ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  private toError(sim: { code: number; logs: string[] }): Error {
    if (sim.code === ANCHOR_ACCOUNT_NOT_INITIALIZED) {
      const origin = AnchorError.parse(sim.logs)?.error.origin;
      if (origin === "policy") return new PulsoProgramError(PULSO_ERRORS.PolicyNotFound);
    }
    const known = pulsoErrorFromCode(sim.code);
    return known ? new PulsoProgramError(known) : new Error(`Program error ${sim.code}\n${sim.logs.join("\n")}`);
  }

  private async chainNow(): Promise<bigint> {
    try {
      const t = await this.connection.getBlockTime(await this.connection.getSlot());
      if (t !== null) return BigInt(t);
    } catch {
      // fall through to the local clock
    }
    return BigInt(Math.floor(Date.now() / 1000));
  }

  private async postApproval(pending: PendingApproval, mint: PublicKey): Promise<void> {
    const f = pending.intent.fields;
    const res = await this.fetchFn(`${this.approvalsUrl}/api/approvals`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        programId: f.programId.toBase58(),
        policy: this.policy.toBase58(),
        authority: f.authority.toBase58(),
        agent: f.agent.toBase58(),
        mint: mint.toBase58(),
        recipient: f.recipient.toBase58(),
        amount: f.amount.toString(),
        expiresAt: f.expiresAt.toString(),
        maxUses: f.maxUses,
        nonce: hex(f.nonce),
        actionHash: pending.approvalId,
      }),
    });
    if (!res.ok) throw new Error(`Approvals backend rejected the request: HTTP ${res.status} ${await res.text()}`);
  }

  /** Activity is display-only; bounded best-effort logging never changes chain results. */
  private async postActivity(
    a: ActivityDraft,
  ): Promise<void> {
    if (!this.activityUrl) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const event: ActivityInput = {
        ...a,
        eventId: globalThis.crypto.randomUUID(),
        authority: this.human.toBase58(),
        agent: this.agent.publicKey.toBase58(),
        programId: this.programId.toBase58(),
        policy: this.policy.toBase58(),
        amount: a.amount.toString(),
        recipient: a.recipient.toBase58(),
      };
      const controller = new AbortController();
      await Promise.race([
        this.fetchFn(`${this.activityUrl}/api/activity`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(event),
          signal: controller.signal,
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("activity logging timeout"));
          }, 750);
        }),
      ]);
    } catch {
      // Telemetry must never mask a result from the program or RPC.
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** Backend status is only a hint; network failures are ignored because the chain decides. */
  private async backendStatus(id: string): Promise<string | undefined> {
    try {
      const res = await this.fetchFn(`${this.approvalsUrl}/api/approvals/${id}`);
      if (!res.ok) return undefined;
      return ((await res.json()) as { status?: string }).status;
    } catch {
      return undefined;
    }
  }
}
