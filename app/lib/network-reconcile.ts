// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: reconciliation READS the chain and records the fact on the request. It does NOT
// authorize spending and does NOT stop it; the money moves (or not) in the on-chain program. `verificado`
// means "this transaction matches the terms of this request", not a second authorization: the receiver's
// signature is application consent, the transaction proves what the program enforced, and there is NO
// receiver co-signature and NO double authorization on-chain (spec 14 section 8).
//
// Flow of POST (spec 14 section 8): line 9 (bind the reported signature) under the collection lock, then
// RPC reads with no lock held, then ONE compare-and-set write under the lock (`systemTransition` with
// `expectRev`): state + payment evidence together. A refusal never burns the request.
// The client sends only a signature. It never sends a status, a mode, an amount or a result.
import { PublicKey, Connection } from "@solana/web3.js";
// Subpath import on purpose: the "@pulso/sdk" barrel pulls the Anchor client, which breaks the Next route bundle.
import { verifyAuthorityReceipt, type AuthorityReceipt, type ReceiptConnection } from "@pulso/sdk/src/receipt.js";
import { RPC_URL } from "./config";
import { defaultDir } from "./network-auth";
import {
  REQUESTS, applyTransition, digestOf, getRequest, settleExpiry, systemTransition,
  type B2BRequest, type Late, type Payment, type RequestOut, type Status, type SystemEvent,
} from "./network-requests";
import { mutateCollection, type Fail } from "./network-store";
import { readOrgs } from "./network-store-orgs";

export type Commitment = "confirmed" | "finalized";
/** The subset of web3's Connection this module (and the SDK verifier) touches. A test double implements exactly this. */
export type ReconcileConnection = ReceiptConnection & Pick<Connection, "getSignatureStatuses" | "getGenesisHash">;
export interface ReconcileDeps { dir: string; now: number; connection: ReconcileConnection; commitment: Commitment }

/**
 * `code`, success side: VERIFIED, CONFIRMED_UNVERIFIED (exists, verification inconclusive: retry), PENDING (TX_NOT_FOUND,
 * BELOW_COMMITMENT: not seen at the commitment yet), RPC_ERROR, CLUSTER_MISMATCH (the server's RPC is on another cluster:
 * a server setting, not a fact about the transaction; nothing is recorded, retry once the RPC is fixed), LATE_RECORDED, DUPLICATE_RECORDED.
 * Refusal side (`refused: true`): TX_FAILED, AMOUNT_NOT_EXACT, SNAPSHOT_MISMATCH, SIGNATURE_IN_USE and every refusal of receipt v1.
 */
export interface Reconcile { code: string; detail?: string; retry: boolean; refused: boolean; warning?: "RECIPIENT_OWNER_CHANGED" }
export interface ReconcileOut { request: RequestOut; reconcile: Reconcile | null }

const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;
const TERMINAL: Status[] = ["cancelado", "expirado", "recusado"];
const RANK: Record<string, number> = { processed: 1, confirmed: 2, finalized: 3 };
const LATE_REASON = { cancelado: "after_cancel", recusado: "after_refusal", expirado: "after_expiry" } as const;
const iso = (ms: number) => new Date(ms).toISOString();

const notFound: Fail = { error: "request not found", status: 404, code: "NOT_FOUND" };
const inUse: Fail = { error: "this signature is already linked to another request", status: 409, code: "SIGNATURE_IN_USE" };
const ok = (code: string, extra: Partial<Reconcile> = {}): Reconcile => ({ code, retry: false, refused: false, ...extra });
const pending = (code: string, detail?: string): Reconcile => ({ code, detail, retry: true, refused: false });
const refusal = (code: string, detail?: string): Reconcile => ({ code, detail, retry: false, refused: true });
/** An attempt's `reason` is `CODE` or `CODE: detail`. */
const fromReason = (reason: string): Reconcile => {
  const at = reason.indexOf(": ");
  return at < 0 ? refusal(reason) : refusal(reason.slice(0, at), reason.slice(at + 2));
};

/** The signature -> request index, derived from the requests themselves so it can never drift: reported, consumed, late or duplicate. */
const linked = (x: B2BRequest, sig: string) =>
  x.signature === sig || x.evidence.payment?.signature === sig || x.late?.signature === sig || !!x.evidence.duplicates?.some((d) => d.signature === sig);
const usedElsewhere = (id: string, sig: string) => (items: B2BRequest[]): Fail | null => (items.some((x) => x.id !== id && linked(x, sig)) ? inUse : null);

export function commitmentFromEnv(value = process.env.PULSO_NETWORK_COMMITMENT): Commitment {
  if (!value) return "confirmed";
  if (value === "confirmed" || value === "finalized") return value;
  throw new Error("PULSO_NETWORK_COMMITMENT must be confirmed or finalized");
}

export function defaultReconcileDeps(): ReconcileDeps {
  const commitment = commitmentFromEnv();
  return { dir: defaultDir(), now: Date.now(), connection: new Connection(RPC_URL, commitment), commitment };
}

// ---------- the wrapper checks the base receipt does not make ----------

/** Compares the receipt with the snapshot (spec 14 section 8 table). Returns the refusal, or null when everything matches. */
async function mismatch(deps: ReconcileDeps, r: B2BRequest, receipt: AuthorityReceipt): Promise<Reconcile | null> {
  const s = r.snapshot;
  if (receipt.amount !== s.amount) return refusal("AMOUNT_NOT_EXACT", `paid ${receipt.amount}, the request is for exactly ${s.amount}`);
  const pairs: [string, string, string][] = [
    ["mint", receipt.mint, s.mint], ["recipient", receipt.recipient, s.recipientTokenAccount], ["nonce", receipt.nonce, s.nonce],
    ["programId", receipt.programId, s.programId], ["policy", receipt.policy, s.policy], ["human", receipt.human, s.payerAuthority], ["agent", receipt.agent, s.agent],
  ];
  const wrong = pairs.find(([, got, want]) => got !== want);
  if (wrong) return refusal("SNAPSHOT_MISMATCH", `${wrong[0]} differs from the request`);
  let digest: string | null = null;
  try { digest = digestOf(s); } catch { /* malformed snapshot: refused below */ }
  if (digest !== r.digest) return refusal("SNAPSHOT_MISMATCH", "the stored terms no longer match their digest");
  const org = (await readOrgs(deps.dir)).find((o) => o.authority === s.receiverAuthority);
  const known = org && [org.receivingAccount, ...org.receivingAccountHistory].some((a) => a?.tokenAccount === s.recipientTokenAccount);
  if (!known) return refusal("SNAPSHOT_MISMATCH", "the receiving organization no longer has this authority and token account");
  return null;
}

/** Informational: who owns the destination token account right now (SPL owner field, bytes 32..64). Never a refusal. */
async function ownerNow(deps: ReconcileDeps, tokenAccount: string): Promise<string | null> {
  try {
    const info = await deps.connection.getAccountInfo(new PublicKey(tokenAccount), { commitment: deps.commitment });
    return info && info.data.length >= 64 ? new PublicKey(info.data.subarray(32, 64)).toBase58() : null;
  } catch {
    return null;
  }
}

// ---------- POST ----------

type Bound = Fail | { done: Reconcile } | { go: B2BRequest };

/**
 * Participants only (anyone else: 404). Binds the signature (line 9), reads the chain, records the result.
 * Idempotent: the same signature again returns the recorded result, or re-verifies an `enviado`/`confirmado` request (safe retry).
 * A request already ended (`cancelado`, `expirado`, `recusado`) takes the late-payment path (line 13): marked only if the full verification passes.
 */
export async function reconcileRequest(deps: ReconcileDeps, me: string, id: string, input: { signature?: unknown }): Promise<ReconcileOut | Fail> {
  const sig = input.signature;
  if (typeof sig !== "string" || !BASE58_SIG.test(sig)) return { error: "signature must be a base58 transaction signature", status: 400, code: "BAD_SIGNATURE" };
  let last: ReconcileOut | Fail = notFound;
  for (let i = 0; i < 3; i += 1) {
    last = await once(deps, me, id, sig);
    if (!("error" in last) || last.code !== "CONFLICT") return last;
  }
  return last;
}

async function present(deps: ReconcileDeps, me: string, id: string, reconcile: Reconcile | null): Promise<ReconcileOut | Fail> {
  const request = await getRequest(deps, me, id);
  return "error" in request ? request : { request, reconcile };
}

/** A Fail from a transition carries the raw request in `current`; the client gets the presented one instead. */
async function failure(deps: ReconcileDeps, me: string, id: string, f: Fail): Promise<Fail> {
  const { current, ...rest } = f;
  if (!current) return rest as Fail;
  const request = await getRequest(deps, me, id);
  return "error" in request ? rest as Fail : { ...rest, current: request } as Fail;
}

async function once(deps: ReconcileDeps, me: string, id: string, sig: string): Promise<ReconcileOut | Fail> {
  const bound = await mutateCollection<B2BRequest, Bound>(deps.dir, REQUESTS, (items) => {
    const i = items.findIndex((r) => r.id === id && (r.snapshot.payerAuthority === me || r.snapshot.receiverAuthority === me));
    if (i < 0) return notFound;
    const cur = settleExpiry(items[i], deps.now); // lazy expiry is persisted here, like on every write
    if (cur !== items[i]) items[i] = cur;
    const refused = cur.attempts.find((a) => a.signature === sig); // a refusal is deterministic: do not re-run it
    if (refused && cur.status !== "enviado" && cur.status !== "confirmado" && cur.status !== "verificado") return { done: fromReason(refused.reason) };

    if (cur.status === "verificado") {
      if (cur.evidence.payment?.signature === sig) return { done: ok("VERIFIED") };
      if (cur.evidence.duplicates?.some((d) => d.signature === sig)) return { done: ok("DUPLICATE_RECORDED") };
      return { go: cur };
    }
    if (TERMINAL.includes(cur.status)) {
      if (cur.late?.signature === sig) return { done: ok("LATE_RECORDED") };
      if (cur.late) return { error: "a late payment is already recorded", status: 409, code: "STATE", current: cur };
      return { go: cur };
    }
    if (cur.status === "aguardando autorização") {
      const clash = usedElsewhere(id, sig)(items);
      if (clash) return clash;
    }
    const res = applyTransition(cur, { type: "submit", signature: sig }, me, deps.now); // line 9 (or its idempotent repeat)
    if (!res.ok) return { ...res.fail, current: res.request };
    if (res.changed) items[i] = res.request;
    return { go: res.request };
  });
  if ("error" in bound) return failure(deps, me, id, bound);
  if ("done" in bound) return present(deps, me, id, bound.done);
  return inspect(deps, me, bound.go, sig);
}

// ---------- the chain read and the one write ----------

/** `systemTransition` result -> either the fresh state with `reconcile`, or the Fail (a CONFLICT makes the caller start over). */
async function written(deps: ReconcileDeps, me: string, id: string, r: B2BRequest | Fail, reconcile: Reconcile): Promise<ReconcileOut | Fail> {
  return "error" in r ? failure(deps, me, id, r) : present(deps, me, id, reconcile);
}

async function inspect(deps: ReconcileDeps, me: string, r: B2BRequest, sig: string): Promise<ReconcileOut | Fail> {
  const s = r.snapshot;
  const live = r.status === "enviado" || r.status === "confirmado";
  const sys = { dir: deps.dir, now: deps.now };
  const stay = (c: Reconcile) => present(deps, me, r.id, c);
  const refuse = async (code: string, detail?: string) => {
    if (!live) return stay(refusal(code, detail)); // ended or already verified: the refusal is only reported, nothing is written
    const reason = (detail ? `${code}: ${detail}` : code).slice(0, 300);
    return written(deps, me, r.id, await systemTransition(sys, r.id, { type: "fail", attempt: { signature: sig, reason } }, r.rev), refusal(code, detail));
  };

  // The genesis check comes first on purpose: on the wrong cluster the signature would never be found. It is the server's RPC that is
  // wrong, not the transaction, so nothing is recorded: a refusal here would burn a good signature for this request.
  let genesis: string;
  try { genesis = await deps.connection.getGenesisHash(); } catch (e) { return stay(pending("RPC_ERROR", msg(e))); }
  if (genesis !== s.genesis) return stay(pending("CLUSTER_MISMATCH", `the RPC is on ${genesis}, the request is for ${s.genesis}`));

  // Step A: existence.
  let status;
  try { status = (await deps.connection.getSignatureStatuses([sig], { searchTransactionHistory: true })).value[0]; } catch (e) { return stay(pending("RPC_ERROR", msg(e))); }
  if (!status) return stay(pending("TX_NOT_FOUND", "the transaction is not visible to the RPC yet"));
  if (status.err) return refuse("TX_FAILED", JSON.stringify(status.err));
  if ((RANK[status.confirmationStatus ?? ""] ?? 0) < RANK[deps.commitment]) return stay(pending("BELOW_COMMITMENT", `waiting for ${deps.commitment}`));

  // Step B: the SDK verifier, unchanged, then what it does not check.
  const verdict = await verifyAuthorityReceipt(
    deps.connection, sig,
    { recipient: new PublicKey(s.recipientTokenAccount), mint: new PublicKey(s.mint), minAmount: BigInt(s.amount), nonce: Buffer.from(s.nonce, "hex"), acceptedAuthorities: [new PublicKey(s.payerAuthority)] },
    { programId: new PublicKey(s.programId), commitment: deps.commitment, cluster: genesis },
  );
  if (!verdict.ok) {
    if (verdict.reason !== "RPC_ERROR" && verdict.reason !== "TX_NOT_FOUND") return refuse(verdict.reason, verdict.detail);
    // Step A saw it, step B could not finish: line 10. Safe to repeat.
    if (r.status !== "enviado") return stay(pending(live ? "CONFIRMED_UNVERIFIED" : verdict.reason, verdict.detail));
    return written(deps, me, r.id, await systemTransition(sys, r.id, { type: "confirm" }, r.rev), pending("CONFIRMED_UNVERIFIED", verdict.detail));
  }
  const receipt = verdict.receipt;
  const wrong = await mismatch(deps, r, receipt);
  if (wrong) return refuse(wrong.code, wrong.detail);

  const owner = await ownerNow(deps, s.recipientTokenAccount);
  const warning = owner !== null && owner !== s.receiverAuthority ? ({ warning: "RECIPIENT_OWNER_CHANGED" } as const) : {};
  const hooks = { check: usedElsewhere(r.id, sig) };
  const afterClash = async (out: B2BRequest | Fail, good: Reconcile) => ("error" in out && out.code === "SIGNATURE_IN_USE" ? refuse("SIGNATURE_IN_USE", out.error) : written(deps, me, r.id, out, good));

  if (live) {
    const landed = receipt.blockTime ?? Math.floor(deps.now / 1000); // no block time: the server's observation time stands in
    const late: Late | undefined = landed > Number(s.expiry) ? { reason: "after_expiry_landed", signature: sig, commitment: deps.commitment, verified: true } : undefined;
    const approved = receipt.mode === "approved";
    const payment: Payment = {
      signature: sig, commitment: deps.commitment, slot: receipt.slot, blockTime: receipt.blockTime, ...(receipt.blockTime === null ? { observedAt: iso(deps.now) } : {}),
      receipt, mode: approved ? "aprovado" : "autônomo", ...(approved ? { intent: receipt.intent, actionHash: receipt.actionHash } : {}),
    };
    const event: SystemEvent = { type: "verify", ...(late ? { late } : {}) };
    const patch = (next: B2BRequest): B2BRequest => ({ ...next, evidence: { ...next.evidence, payment, recipientOwnerAtVerification: owner } });
    return afterClash(await systemTransition(sys, r.id, event, r.rev, { ...hooks, patch }), ok("VERIFIED", warning));
  }
  if (r.status === "verificado") {
    // A second valid payment: recorded, state untouched. The money already left; this only tells the truth.
    const out = await mutateCollection<B2BRequest, Fail | null>(deps.dir, REQUESTS, (items) => {
      const i = items.findIndex((x) => x.id === r.id);
      if (i < 0) return notFound;
      if (items[i].rev !== r.rev) return { error: "request changed; retry", status: 409, code: "CONFLICT" };
      const clash = hooks.check(items);
      if (clash) return clash;
      const x = items[i];
      items[i] = { ...x, rev: x.rev + 1, updatedAt: iso(deps.now), evidence: { ...x.evidence, duplicates: [...(x.evidence.duplicates ?? []), { signature: sig, commitment: deps.commitment, at: iso(deps.now) }] } };
      return null;
    });
    if (out && out.code === "SIGNATURE_IN_USE") return refuse("SIGNATURE_IN_USE", out.error);
    return out ? failure(deps, me, r.id, out) : present(deps, me, r.id, ok("DUPLICATE_RECORDED"));
  }
  // Line 13: the request had already ended. The state stays; only the fact is marked.
  const late: Late = { reason: LATE_REASON[r.status as keyof typeof LATE_REASON], signature: sig, commitment: deps.commitment, verified: true };
  return afterClash(await systemTransition(sys, r.id, { type: "late", late }, r.rev, hooks), ok("LATE_RECORDED", warning));
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

// ---------- GET ----------

/** What the stored state says, no chain read: the same history and evidence for both participants. Third parties get 404. */
export async function getReconciliation(deps: { dir: string; now: number }, me: string, id: string): Promise<ReconcileOut | Fail> {
  const request = await getRequest(deps, me, id);
  if ("error" in request) return request;
  const last = request.attempts.at(-1);
  const reconcile: Reconcile | null =
    request.status === "verificado" ? ok("VERIFIED")
    : request.status === "confirmado" ? pending("CONFIRMED_UNVERIFIED")
    : request.status === "enviado" ? pending("PENDING")
    : request.late ? ok("LATE_RECORDED")
    : request.status === "aguardando autorização" && last ? fromReason(last.reason)
    : null;
  return { request, reconcile };
}
