import { PulsoClient, PulsoProgramError, type PendingApproval, type WaitOptions } from "@pulso/sdk";
import { getAccount } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { loadAddresses, loadKeypair, usdc, type Cluster, type DemoAddresses } from "./setup.js";

// The demo agent is deterministic on purpose: no LLM and no randomness in its logic.
// It holds only its own key (the muscle); it never touches the human's key (the pacemaker).

export interface Action {
  label: string;
  /** Base units. */
  amount: bigint;
  /** Destination token account. */
  recipient: PublicKey;
}

export interface StepResult {
  label: string;
  amount: string;
  decision: "EXECUTED" | "PAUSED" | "REJECTED";
  /** Set when an execution waited for the human first. */
  approved?: boolean;
  /** PULSO error name when REJECTED. */
  error?: string;
  signature?: string;
}

export interface AgentResult {
  steps: StepResult[];
  vaultBefore: string;
  vaultAfter: string;
  spentInWindow: string;
}

export interface RunOptions {
  addresses: DemoAddresses;
  actions: Action[];
  log?: (line: string) => void;
  /** Optional best-effort activity display endpoint. */
  activityUrl?: string;
  /**
   * Called when the policy asks for the human. After it returns, the agent waits for the intent
   * to exist on-chain and then repeats exactly the approved action. Without it the action stays paused.
   */
  onPause?: (pending: PendingApproval) => Promise<void>;
  /** Approvals web app, for the UI approval mode. */
  approvalsUrl?: string;
  waitOptions?: WaitOptions;
}

/** Fixed sequence for `pnpm agent`: one autonomous beat, one pause, one rejection. */
export function defaultActions(a: DemoAddresses): Action[] {
  const merchant = new PublicKey(a.merchantTokenAccount);
  return [
    { label: "Pay merchant (small)", amount: usdc(5), recipient: merchant },
    { label: "Pay merchant (large)", amount: usdc(100), recipient: merchant },
    { label: "Pay merchant (over the cap)", amount: usdc(600), recipient: merchant },
  ];
}

const fmt = (base: bigint, decimals = 6) => {
  const unit = 10n ** BigInt(decimals);
  return `${base / unit}.${(base % unit).toString().padStart(decimals, "0").slice(0, 2)}`;
};
const short = (s: string) => `${s.slice(0, 12)}…`;

// Plain-language reading of each error, next to its technical code (docs/ELEMENTOS_DE_CORACAO.md).
const PHRASES: Record<string, string> = {
  PolicyNotFound: "no resting rhythm defined",
  PolicyDisabled: "policy switched off by the human",
  IntentExpired: "the impulse arrived late",
  IntentAlreadyUsed: "refractory period: one impulse, one beat",
  IntentMismatch: "this action is not the one the pacemaker approved",
  RecipientNotAllowed: "unmapped vessel (new recipient needs approval)",
  AmountExceedsLimit: "above the stroke volume (per-transaction cap)",
  DailyLimitExceeded: "daily output exhausted (daily limit)",
  UnauthorizedAgent: "muscle of another heart",
};

export async function runAgent(o: RunOptions): Promise<AgentResult> {
  const log = o.log ?? (() => {});
  const { addresses: a } = o;
  const connection = new Connection(a.rpcUrl, "confirmed");
  const client = new PulsoClient({
    connection,
    agent: loadKeypair(a.cluster, "agent"),
    human: new PublicKey(a.human),
    approvalsUrl: o.approvalsUrl,
    activityUrl: o.activityUrl,
  });
  const vault = new PublicKey(a.vault);
  const policy = await client.getPolicy();
  if (!policy) throw new Error("Policy not found. Run setup first.");
  const threshold = BigInt(policy.requireApprovalAbove.toString());
  const cap = BigInt(policy.maxPerTransaction.toString());
  const balance = async () => (await getAccount(connection, vault)).amount;
  const spent = async () => BigInt(((await client.getPolicy())?.spentInWindow ?? 0).toString());

  const vaultBefore = await balance();
  log(`Vault (the chamber): ${fmt(vaultBefore)} USDC   spent today: ${fmt(await spent())} USDC`);

  const steps: StepResult[] = [];
  for (const act of o.actions) {
    const amt = fmt(act.amount);
    log("");
    log(`▸ Agent requests: send ${amt} USDC → merchant  [${act.label}]`);
    const step: StepResult = { label: act.label, amount: amt, decision: "EXECUTED" };
    try {
      const r = await client.execute({ amount: act.amount, recipient: act.recipient });
      if (r.status === "executed") {
        log(`  ♥ beat  — within resting rhythm (${amt} ≤ ${fmt(threshold)} autonomous limit) → EXECUTED  sig=${short(r.signature)}`);
        step.signature = r.signature;
      } else {
        step.decision = "PAUSED";
        const f = r.intent.fields;
        log(`  ⏸ pause — ${r.reason} (${amt} > ${fmt(threshold)}) → waiting for the pacemaker (human approval)`);
        log("    exact payload to approve:");
        log(`      amount      ${fmt(f.amount)} USDC (${f.amount} base units)`);
        log(`      recipient   ${f.recipient.toBase58()}`);
        log(`      mint        ${f.mint.toBase58()}`);
        log(`      expires at  ${new Date(Number(f.expiresAt) * 1000).toISOString()} (unix ${f.expiresAt})`);
        log(`      nonce       ${Buffer.from(f.nonce).toString("hex")}`);
        log(`      action hash ${r.approvalId}`);
        if (!o.onPause) {
          log("    (no approver in this run: the action stays paused)");
        } else {
          await o.onPause(r);
          await client.waitForApproval(r, o.waitOptions);
          const done = await client.executeApproved(r);
          log(`  ♥ beat  — approved impulse, exact action repeated → EXECUTED  sig=${short(done.signature)}`);
          step.decision = "EXECUTED";
          step.approved = true;
          step.signature = done.signature;
        }
      }
    } catch (e) {
      if (!(e instanceof PulsoProgramError)) throw e;
      step.decision = "REJECTED";
      step.error = e.error.message;
      log(`  ✕ valve closed — ${e.error.message}${PHRASES[e.error.name] ? ` (${PHRASES[e.error.name]})` : ""}`);
    }
    steps.push(step);
  }

  const vaultAfter = await balance();
  const spentNow = await spent();
  log("");
  log(`Vault (the chamber): ${fmt(vaultBefore)} → ${fmt(vaultAfter)} USDC   spent today: ${fmt(spentNow)} / ${fmt(BigInt(policy.dailyLimit.toString()))} USDC (cap per transaction ${fmt(cap)})`);
  return { steps, vaultBefore: fmt(vaultBefore), vaultAfter: fmt(vaultAfter), spentInWindow: fmt(spentNow) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((x) => x !== "--"),
    options: { cluster: { type: "string", default: "localnet" }, json: { type: "boolean", default: false } },
  });
  const addresses = loadAddresses(values.cluster as Cluster);
  runAgent({ addresses, actions: defaultActions(addresses), log: values.json ? undefined : console.log })
    .then((r) => values.json && console.log(JSON.stringify(r, null, 2)))
    .catch((e: Error) => {
      console.error(`agent failed: ${e.message}`);
      process.exit(1);
    });
}
