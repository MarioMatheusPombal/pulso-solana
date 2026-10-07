import anchor from "@anchor-lang/core";
import { PROGRAM_ID, PulsoClient, PulsoProgramError, findPolicyPda, getProgram, type PendingApproval, type WaitOptions } from "@pulso/sdk";
import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { validatePackage, type RefusalCode, type Validated } from "./b2b-package.js";
import { loadKeypair, type Cluster } from "./setup.js";

const { BN } = anchor;

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// B2B agent adapter (solana/14_B2B_NETWORK_SPEC.md, section 7). It reads a `pulso-b2b-package-v1` file,
// validates it offline (b2b-package.ts) and runs the existing PulsoClient flow with the EXACT snapshot
// values. It has no backend session. It holds only the agent key; the human's key is never read here
// (the localnet `--approve auto` fixture is the one exception, same as the A/B demo).
//
// Exactly-once, with the limit stated:
//  - Approved branch: the nonce is in the action hash and the intent is single-use, so the program
//    refuses a second execution (INTENT_ALREADY_USED). On-chain guarantee.
//  - Autonomous branch: the program only CARRIES the nonce. Nothing on-chain stops a second execution
//    with the same nonce. What this file adds is client-side only: one sent signature per request is
//    kept in a local state file and is never resent while it may still land. It does not stop another
//    process, another machine or a state file that was deleted. The demo uses a policy that requires
//    an intent for the request amount, so the approved branch carries the guarantee.

export type RefusalOrState = RefusalCode | "SEND_PENDING" | "INTENT_MISMATCH";

export class B2BRefusal extends Error {
  constructor(
    readonly code: RefusalOrState,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}

export type Mode = "autonomous" | "approved";

/** What survives a timeout or restart: the blockhash before sending, the signature right after. */
export interface SentState {
  requestId: string;
  mode: Mode;
  blockhash: string;
  signature?: string;
  at: string;
}

export type Outcome =
  | { status: "executed"; mode: Mode; signature: string; requestId: string; alreadySent: boolean }
  | { status: "paused"; requestId: string; approvalId: string; approvalUrl: string | undefined };

export interface ConnectionLike {
  getGenesisHash(): Promise<string>;
  getSignatureStatuses(
    signatures: string[],
    config: { searchTransactionHistory: boolean },
  ): Promise<{ value: ({ err: unknown; confirmationStatus?: string } | null)[] }>;
  isBlockhashValid(blockhash: string, config: { commitment: "confirmed" }): Promise<{ value: boolean }>;
  /** Set by `executePackage` so the state is written before the transaction leaves the process. */
  onSend?: (blockhash: string) => void;
  onSent?: (signature: string) => void;
}

/** Real connection that reports every transaction it sends (the SDK hides the signature until confirmation). */
export class RecordingConnection extends Connection implements ConnectionLike {
  onSend?: (blockhash: string) => void;
  onSent?: (signature: string) => void;
  override async sendRawTransaction(raw: Buffer | Uint8Array | number[], options?: Parameters<Connection["sendRawTransaction"]>[1]): Promise<string> {
    this.onSend?.(Transaction.from(raw).recentBlockhash!);
    const signature = await super.sendRawTransaction(raw, options);
    this.onSent?.(signature);
    return signature;
  }
}

export type ClientLike = Pick<PulsoClient, "execute" | "waitForApproval" | "executeApproved">;

export interface ExecuteOptions {
  /** Parsed package JSON; untrusted. */
  pkg: unknown;
  agent: PublicKey;
  programId?: PublicKey;
  connection: ConnectionLike;
  /** Built after validation, from the package's payer authority. */
  makeClient: (payerAuthority: PublicKey) => ClientLike;
  /** Directory of per-request state files. Keep it outside Git. */
  stateDir: string;
  /** Unix seconds; injectable for tests. */
  now?: () => number;
  /** Publishes nothing itself (the client already did); lets the human approve. Without it the request stays paused. */
  onPause?: (pending: PendingApproval, v: Validated) => Promise<void>;
  waitOptions?: WaitOptions;
  log?: (line: string) => void;
}

const stateFile = (dir: string, id: string) => join(dir, `${id}.json`);
const readState = (dir: string, id: string): SentState | null => {
  const f = stateFile(dir, id);
  return existsSync(f) ? (JSON.parse(readFileSync(f, "utf8")) as SentState) : null;
};
function writeState(dir: string, s: SentState) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${stateFile(dir, s.requestId)}.tmp`;
  writeFileSync(tmp, JSON.stringify(s, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, stateFile(dir, s.requestId));
}

/**
 * Before any send: look at what a previous run already sent for this request.
 * Confirmed: report it, never resend. Possibly still landing: refuse. Failed on-chain or blockhash expired
 * without landing: the old transaction can never land, so a new attempt is safe.
 */
async function settlePrior(c: ConnectionLike, dir: string, id: string): Promise<SentState | null> {
  const prior = readState(dir, id);
  if (!prior) return null;
  if (prior.signature) {
    const st = (await c.getSignatureStatuses([prior.signature], { searchTransactionHistory: true })).value[0];
    if (st && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) return prior;
    if (st?.err) {
      rmSync(stateFile(dir, id));
      return null;
    }
    if (st) throw new B2BRefusal("SEND_PENDING", `signature ${prior.signature} is processed but not confirmed yet; not resending`);
  }
  if ((await c.isBlockhashValid(prior.blockhash, { commitment: "confirmed" })).value) {
    throw new B2BRefusal("SEND_PENDING", `a transaction for this request may still land (signature ${prior.signature ?? "unknown"}); not resending`);
  }
  rmSync(stateFile(dir, id));
  return null;
}

export async function executePackage(o: ExecuteOptions): Promise<Outcome> {
  const log = o.log ?? (() => {});
  const now = o.now ?? (() => Math.floor(Date.now() / 1000));
  const check = async (): Promise<Validated> => {
    const v = validatePackage(o.pkg, { agent: o.agent, programId: o.programId ?? PROGRAM_ID, genesis: await o.connection.getGenesisHash(), nowSeconds: now() });
    if (!v.ok) throw new B2BRefusal(v.code, v.detail);
    return v.value;
  };
  const v = await check();
  const { terms, requestId } = v;
  log(`package ok: ${v.kind} ${requestId}  amount ${terms.amount} base units → ${terms.recipientTokenAccount.toBase58()}`);

  const prior = await settlePrior(o.connection, o.stateDir, requestId);
  if (prior) return { status: "executed", mode: prior.mode, signature: prior.signature!, requestId, alreadySent: true };

  let mode: Mode = "autonomous";
  // Only the payment itself is recorded: not the human's record_intent (or anything else) sent through the same connection while paused.
  let paying = true;
  o.connection.onSend = (blockhash) => paying && writeState(o.stateDir, { requestId, mode, blockhash, at: new Date().toISOString() });
  o.connection.onSent = (signature) => paying && writeState(o.stateDir, { ...readState(o.stateDir, requestId)!, signature });

  const client = o.makeClient(terms.payerAuthority);
  try {
    // Exact snapshot values; the 16-byte nonce is never the SDK's zero default.
    const r = await client.execute({ amount: terms.amount, recipient: terms.recipientTokenAccount, nonce: terms.nonce });
    if (r.status === "executed") return { status: "executed", mode, signature: r.signature, requestId, alreadySent: false };

    log(`policy asks for the human (${r.reason}); action hash ${r.approvalId}`);
    if (!o.onPause) return { status: "paused", requestId, approvalId: r.approvalId, approvalUrl: r.approvalUrl };
    paying = false;
    await o.onPause(r, v);
    await client.waitForApproval(r, o.waitOptions);

    // The backend saying "approved" authorizes nothing: re-check the terms and that the intent is for exactly them.
    const again = await check();
    const f = r.intent.fields;
    const same =
      again.digest === v.digest &&
      f.programId.equals(terms.programId) &&
      f.authority.equals(terms.payerAuthority) &&
      f.agent.equals(terms.agent) &&
      f.mint.equals(terms.mint) &&
      f.recipient.equals(terms.recipientTokenAccount) &&
      f.amount === terms.amount &&
      Buffer.from(f.nonce).toString("hex") === requestId;
    if (!same) throw new B2BRefusal("INTENT_MISMATCH", "the approved intent is not exactly the snapshot");
    paying = true;
    mode = "approved";
    const done = await client.executeApproved(r);
    return { status: "executed", mode, signature: done.signature, requestId, alreadySent: false };
  } finally {
    o.connection.onSend = undefined;
    o.connection.onSent = undefined;
  }
}

// ---------- CLI: pnpm b2b -- --package <file> ----------

const CODE_EXIT = { refused: 2, rejected: 3, pending: 4 } as const;

async function main() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((x) => x !== "--"),
    options: {
      package: { type: "string" },
      cluster: { type: "string", default: "localnet" },
      rpc: { type: "string" },
      "state-dir": { type: "string" },
      "agent-keypair": { type: "string" },
      approve: { type: "string", default: "ui" },
      "approvals-url": { type: "string" },
      json: { type: "boolean", default: false },
    },
  });
  if (!values.package) throw new Error("usage: pnpm b2b -- --package <file.json> [--cluster localnet|devnet] [--rpc <url>] [--state-dir <dir>] [--agent-keypair <file>] [--approve ui|auto] [--approvals-url <url>] [--json]");
  const cluster = values.cluster as Cluster;
  const rpcUrl = values.rpc ?? (cluster === "devnet" ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899");
  const stateDir = resolve(values["state-dir"] ?? process.env.PULSO_B2B_STATE_DIR ?? join(import.meta.dirname, "../../.demo", cluster, "b2b-state"));
  const connection = new RecordingConnection(rpcUrl, "confirmed");
  const fixtureConnection = new Connection(rpcUrl, "confirmed"); // the human fixture must not go through the recording connection
  // The agent key: a file OUTSIDE the repo when given (also PULSO_AGENT_KEYPAIR), else the demo fixture of .demo/<cluster>.
  const agentFile = values["agent-keypair"] ?? process.env.PULSO_AGENT_KEYPAIR;
  const agent = agentFile ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(agentFile, "utf8")))) : loadKeypair(cluster, "agent");
  const auto = values.approve === "auto";
  if (auto && cluster !== "localnet") throw new Error("--approve auto signs with the localnet fixture; use --approve ui elsewhere");
  const approvalsUrl = auto ? undefined : (values["approvals-url"] ?? "http://localhost:3000");
  const log = (l: string) => (values.json ? undefined : console.log(l));

  try {
    const out = await executePackage({
      pkg: JSON.parse(readFileSync(values.package, "utf8")),
      agent: agent.publicKey,
      connection,
      stateDir,
      log,
      makeClient: (human) => new PulsoClient({ connection, agent, human, approvalsUrl }),
      waitOptions: auto ? { timeoutMs: 30_000, initialDelayMs: 200, maxDelayMs: 1_000 } : { timeoutMs: 300_000 },
      onPause: async (pending) => {
        if (!auto) return log(`open ${pending.approvalUrl ?? "the approvals app"} to approve; waiting…`);
        // Localnet fixture simulates the authority, as in scenario B.
        const human = loadKeypair("localnet", "human");
        log("localnet fixture signs record_intent (simulated human approval)");
        await getProgram(fixtureConnection, human)
          .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
          .accountsPartial({ authority: human.publicKey, policy: findPolicyPda(human.publicKey, agent.publicKey) })
          .rpc();
      },
    });
    if (values.json) console.log(JSON.stringify(out, null, 2));
    else if (out.status === "executed") console.log(`EXECUTED mode=${out.mode} signature=${out.signature}${out.alreadySent ? " (already sent earlier, not resent)" : ""}\nreport this signature on request ${out.requestId}`);
    else console.log(`PAUSED action hash ${out.approvalId}${out.approvalUrl ? `  approve at ${out.approvalUrl}` : ""}`);
    console.log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
  } catch (e) {
    if (e instanceof B2BRefusal) {
      console.error(`${e.code === "SEND_PENDING" ? "PENDING" : "REFUSED"} ${e.code}: ${e.detail}`);
      process.exit(e.code === "SEND_PENDING" ? CODE_EXIT.pending : CODE_EXIT.refused);
    }
    if (e instanceof PulsoProgramError) {
      console.error(`REJECTED ${e.error.message}`);
      process.exit(CODE_EXIT.rejected);
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e: Error) => {
    console.error(`b2b failed: ${e.message}`);
    process.exit(1);
  });
}
