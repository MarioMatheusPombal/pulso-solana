// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: a request, its status and the consents on it are application state. They do NOT
// authorize spending. Enforcement stays in the on-chain program (policy + record_intent +
// execute_transfer). Cancelling, expiring or declining a request does NOT revoke an intent and does
// NOT stop a transfer. The client never sends a status: lines 10-13 of the transition table are
// reachable only through `systemTransition`, which no route exposes (docs/B2B_NETWORK_SPEC.md sections 5-8).
//
// Agent package `pulso-b2b-package-v1` (GET requests/[id]/package), stable JSON; the agent must NOT
// trust the backend: recompute the digest, check `terms:` in the message, verify Ed25519 offline.
//   { "version": "pulso-b2b-package-v1", "requestId": <hex32>, "kind": "charge"|"send", "status": <Status>,
//     "ready": <status === "aguardando autorização">, "digest": <hex64>,
//     "snapshot": { kind, genesis(base58), programId, policy, payerAuthority, agent, mint,
//                   recipientTokenAccount, receiverAuthority (base58), amount (decimal), nonce (hex32),
//                   expiry (decimal unix seconds) },   // same encodings as tests/vectors/b2b_terms.json
//     "consent": [ { action, message (exact signed UTF-8 text), signature (base64, 64 bytes), signer (base58), at (ISO) } ] }
// The private description is never in the package.
import { createHash, randomBytes } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
// Subpath imports on purpose: the "@pulso/sdk" barrel pulls the Anchor client, which breaks the Next route bundle.
import { computeTermsDigest, termsPreimage, type B2BTerms } from "@pulso/sdk/src/b2b-terms.js";
import { PROGRAM_ID, findPolicyPda, findVaultPda } from "@pulso/sdk/src/pda.js";
import type { AuthorityReceipt } from "@pulso/sdk/src/receipt.js";
import { issueConsentChallenge, parsePubkey, verifyConsent, type AuthDeps, type ConsentEvidence } from "./network-auth";
import { mutateCollection, readCollection, type Fail } from "./network-store";
import { CONNECTIONS, type Connection } from "./network-store-connections";
import { TOKEN_PROGRAM_ID, publicOrg, readOrgs, validateReceivingAccount, type AccountData, type OrgDeps, type Organization, type PublicOrg } from "./network-store-orgs";

export const REQUESTS = "requests";
export const MAX_EXPIRY_MS = 30 * 24 * 3_600_000;
export const MAX_DESCRIPTION = 280;
export const SYSTEM = "system"; // actor of lines 8, 10-13 and of the disconnect cancel; never a pubkey
const U64_MAX = (1n << 64n) - 1n;
const POLICY_DISCRIMINATOR = createHash("sha256").update("account:AgentPolicy").digest().subarray(0, 8);

// ---------- types ----------

export type Kind = "charge" | "send";
export type Status = "aguardando contraparte" | "aguardando autorização" | "enviado" | "confirmado" | "verificado" | "recusado" | "expirado" | "cancelado";
const ACTIVE: Status[] = ["aguardando contraparte", "aguardando autorização"];
const TERMINAL: Status[] = ["cancelado", "expirado", "recusado"];

/** Same encodings as the shared vectors: pubkeys base58, amount/expiry decimal, nonce hex. */
export interface Snapshot {
  kind: Kind; genesis: string; programId: string; policy: string; payerAuthority: string; agent: string; mint: string;
  recipientTokenAccount: string; receiverAuthority: string; amount: string; nonce: string; expiry: string;
}
const SNAPSHOT_KEYS: (keyof Snapshot)[] = ["kind", "genesis", "programId", "policy", "payerAuthority", "agent", "mint", "recipientTokenAccount", "receiverAuthority", "amount", "nonce", "expiry"];

export interface Transition { from: Status | "criado" | null; to: Status | "criado"; actor: string; at: string }
export interface Attempt { signature: string; reason: string; at: string }
/** docs/B2B_NETWORK_SPEC.md section 6, "Late payment": a fact recorded beside a terminal state; never changes it. */
export interface Late { reason: "after_cancel" | "after_refusal" | "after_expiry" | "after_expiry_landed"; signature: string; commitment: string; verified: boolean }

/** Written by reconciliation (#310) in the same write that makes the request `verificado`. */
export interface Payment { signature: string; commitment: "confirmed" | "finalized"; slot: number; blockTime: number | null; observedAt?: string; receipt: AuthorityReceipt; mode: "autônomo" | "aprovado"; intent?: string; actionHash?: string }
/** A second valid payment for a request already `verificado`: informational, the money already left. */
export interface Duplicate { signature: string; commitment: "confirmed" | "finalized"; at: string }

export interface B2BRequest {
  id: string; // = snapshot.nonce
  kind: Kind;
  snapshot: Snapshot;
  digest: string;
  status: Status;
  rev: number;
  evidence: { digest: string; consent: ConsentEvidence[]; payment?: Payment; recipientOwnerAtVerification?: string | null; duplicates?: Duplicate[] }; // last three: #310
  attempts: Attempt[];
  late: Late | null;
  signature: string | null; // payment signature reported by a participant (line 9); #310 owns the rest
  cancellation: { reason: "user" | "edited" | "disconnect"; supersededBy?: string } | null;
  description: string | null; // private; never in the digest, the package or on-chain
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  history: Transition[];
}

// ---------- digest ----------

function toTerms(s: Snapshot): B2BTerms {
  const pk = (v: string) => new PublicKey(v);
  return {
    kind: s.kind, genesis: pk(s.genesis).toBytes(), programId: pk(s.programId), policy: pk(s.policy), payerAuthority: pk(s.payerAuthority),
    agent: pk(s.agent), mint: pk(s.mint), recipientTokenAccount: pk(s.recipientTokenAccount), receiverAuthority: pk(s.receiverAuthority),
    amount: BigInt(s.amount), nonce: Buffer.from(s.nonce, "hex"), expiry: BigInt(s.expiry),
  };
}
export const digestOf = (s: Snapshot) => Buffer.from(computeTermsDigest(toTerms(s))).toString("hex");
const digestOk = (r: B2BRequest) => r.kind === r.snapshot.kind && r.id === r.snapshot.nonce && digestOf(r.snapshot) === r.digest && r.evidence.digest === r.digest;
const digestBroken: Fail = { error: "stored request does not match its digest", status: 500, code: "DIGEST_MISMATCH" };

// ---------- the transition table (docs/B2B_NETWORK_SPEC.md section 6), pure ----------

export type TransitionEvent =
  | { type: "create"; base: { snapshot: Snapshot; digest: string; evidence: ConsentEvidence; description: string | null } } // lines 1-3
  | { type: "accept"; evidence: ConsentEvidence } // 4
  | { type: "decline" } // 5, 6
  | { type: "cancel"; reason: "user" | "edited" | "disconnect"; supersededBy?: string } // 7 (disconnect: system only)
  | { type: "submit"; signature: string } // 9
  | { type: "expire" } // 8
  | { type: "confirm" } // 10
  | { type: "verify"; late?: Late } // 11 (late: after_expiry_landed)
  | { type: "fail"; attempt: { signature: string; reason: string } } // 12
  | { type: "late"; late: Late }; // 13
export type SystemEvent = Extract<TransitionEvent, { type: "expire" | "confirm" | "verify" | "fail" | "late" }>;

type Who = "creator" | "receiver" | "payer" | "participant" | "system";
// `kind` empty = both forms. Line 12's destination depends on expiry; line 13 keeps the state.
const ROWS: { n: number; ev: TransitionEvent["type"]; kind?: Kind; from: Status[]; who: Who }[] = [
  { n: 4, ev: "accept", kind: "send", from: ["aguardando contraparte"], who: "receiver" },
  { n: 5, ev: "decline", kind: "send", from: ["aguardando contraparte"], who: "receiver" },
  { n: 6, ev: "decline", kind: "charge", from: ["aguardando autorização"], who: "payer" },
  { n: 7, ev: "cancel", from: ACTIVE, who: "creator" },
  { n: 8, ev: "expire", from: ACTIVE, who: "system" },
  { n: 9, ev: "submit", from: ["aguardando autorização"], who: "participant" },
  { n: 10, ev: "confirm", from: ["enviado"], who: "system" },
  { n: 11, ev: "verify", from: ["enviado", "confirmado"], who: "system" },
  { n: 12, ev: "fail", from: ["enviado", "confirmado"], who: "system" },
  { n: 13, ev: "late", from: TERMINAL, who: "system" },
];

export type Outcome =
  | { ok: true; request: B2BRequest; changed: boolean }
  | { ok: false; fail: Fail; request: B2BRequest | null; changed: boolean }; // `changed` can be true on failure: lazy expiry still has to be persisted

const iso = (ms: number) => new Date(ms).toISOString();
const expired = (r: B2BRequest, now: number) => now > Number(r.snapshot.expiry) * 1000;
const forbidden = (error: string): Fail => ({ error, status: 403, code: "FORBIDDEN" });
const state = (r: B2BRequest): Fail => ({ error: `request is ${r.status}`, status: 409, code: "STATE" });
const bad = (error: string, code: string): Fail => ({ error, status: 400, code });
const notFound: Fail = { error: "request not found", status: 404, code: "NOT_FOUND" };

/** Line 8, lazy: `now > expiry` on a request still waiting. Used on read (not persisted) and on write (persisted). */
export function settleExpiry(r: B2BRequest, now: number): B2BRequest {
  if (!ACTIVE.includes(r.status) || !expired(r, now)) return r;
  const at = iso(Number(r.snapshot.expiry) * 1000);
  return { ...r, status: "expirado", rev: r.rev + 1, updatedAt: at, history: [...r.history, { from: r.status, to: "expirado", actor: SYSTEM, at }] };
}

const roleOf = (r: B2BRequest, a: string): Who | null =>
  a === SYSTEM ? "system" : a === r.snapshot.payerAuthority ? "payer" : a === r.snapshot.receiverAuthority ? "receiver" : null;

/** Has this same actor already driven the request to the state the event aims at? Then repeating is a no-op (200). */
function alreadyApplied(r: B2BRequest, e: TransitionEvent, actor: string): boolean {
  const by = (to: Status) => r.status === to && r.history.some((h) => h.to === to && h.actor === actor);
  switch (e.type) {
    case "accept": return r.status === "aguardando autorização" && r.evidence.consent.some((c) => c.action === "network.send.accept" && c.authority === actor);
    case "decline": return by("recusado");
    case "cancel": return by("cancelado");
    case "expire": return r.status === "expirado";
    case "submit": return ["enviado", "confirmado", "verificado"].includes(r.status) && r.signature === e.signature;
    case "confirm": return r.status === "confirmado";
    case "verify": return r.status === "verificado";
    case "fail": return (r.status === "aguardando autorização" || r.status === "expirado") && r.attempts.at(-1)?.signature === e.attempt.signature;
    case "late": return TERMINAL.includes(r.status) && r.late?.signature === e.late.signature;
    default: return false;
  }
}

/**
 * The whole table, lines 1-13. `req` is null only for `create`. Checks, in order: participant (else 404),
 * actor class (client events vs system events, else 403), lazy expiry, idempotency, the row for
 * (event, form, current status) (else 409), the row's actor (else 403). Never mutates its input.
 */
export function applyTransition(req: B2BRequest | null, event: TransitionEvent, actor: string, now: number): Outcome {
  if (event.type === "create") return create(req, event.base, actor, now);
  if (!req) return { ok: false, fail: notFound, request: null, changed: false };
  const settled = settleExpiry(req, now);
  const changed = settled !== req;
  const refuse = (fail: Fail): Outcome => ({ ok: false, fail, request: settled, changed });
  const noop: Outcome = { ok: true, request: settled, changed };

  const who = roleOf(settled, actor);
  if (!who) return refuse(notFound);
  const systemEvent = event.type === "expire" || event.type === "confirm" || event.type === "verify" || event.type === "fail" || event.type === "late" || (event.type === "cancel" && event.reason === "disconnect");
  if (systemEvent !== (who === "system")) return refuse(forbidden("this transition is not available to this actor"));

  if (alreadyApplied(settled, event, actor)) return noop;
  const row = ROWS.find((x) => x.ev === event.type && x.from.includes(settled.status) && (!x.kind || x.kind === settled.kind));
  if (!row) return refuse(state(settled));
  const allowed = row.who === "participant" ? who === "payer" || who === "receiver"
    : row.who === "creator" ? who === "system" || actor === settled.createdBy
    : row.who === who;
  if (!allowed) return refuse(forbidden("this actor cannot perform this transition"));
  if (event.type === "expire") return refuse(state(settled)); // lazy expiry already ran; if it had applied we would have returned above

  const next: B2BRequest = { ...settled, history: [...settled.history], rev: settled.rev + 1, updatedAt: iso(now) };
  const move = (to: Status) => { next.history.push({ from: settled.status, to, actor, at: iso(now) }); next.status = to; };
  switch (event.type) {
    case "accept": {
      const c = event.evidence;
      if (c.action !== "network.send.accept" || c.terms !== settled.digest || c.authority !== actor) return refuse(bad("consent does not match this request", "BAD_CONSENT"));
      next.evidence = { ...settled.evidence, consent: [...settled.evidence.consent, c] };
      move("aguardando autorização");
      break;
    }
    case "decline": move("recusado"); break;
    case "cancel": move("cancelado"); next.cancellation = { reason: event.reason, ...(event.supersededBy ? { supersededBy: event.supersededBy } : {}) }; break;
    case "submit":
      if (!/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(event.signature)) return refuse(bad("signature must be a base58 transaction signature", "BAD_SIGNATURE"));
      next.signature = event.signature;
      move("enviado");
      break;
    case "confirm": move("confirmado"); break;
    case "verify": move("verificado"); if (event.late) next.late = event.late; break;
    case "fail":
      next.attempts = [...settled.attempts, { ...event.attempt, at: iso(now) }];
      next.signature = null;
      move(expired(settled, now) ? "expirado" : "aguardando autorização");
      break;
    case "late":
      if (settled.late) return refuse({ error: "a late payment is already recorded", status: 409, code: "STATE" });
      next.late = event.late; // the terminal state stays
      break;
  }
  return { ok: true, request: next, changed: true };
}

/** Lines 1-3: only the form's creator, with that form's consent over this digest; the state goes straight past `criado`. */
function create(existing: B2BRequest | null, base: Extract<TransitionEvent, { type: "create" }>["base"], actor: string, now: number): Outcome {
  const fail = (f: Fail): Outcome => ({ ok: false, fail: f, request: null, changed: false });
  if (existing) return fail({ error: "request id already used", status: 409, code: "ID_TAKEN" });
  const { snapshot: s, digest, evidence, description } = base;
  const charge = s.kind === "charge";
  if (actor !== (charge ? s.receiverAuthority : s.payerAuthority)) return fail(forbidden(charge ? "only the receiver can issue a charge" : "only the payer can propose a send"));
  if (evidence.action !== (charge ? "network.charge.issue" : "network.send.propose") || evidence.terms !== digest || evidence.authority !== actor || digestOf(s) !== digest) return fail(bad("consent does not match this request", "BAD_CONSENT"));
  if (now > Number(s.expiry) * 1000) return fail(bad("expiry is in the past", "INVALID_EXPIRY"));
  const at = iso(now);
  const status: Status = charge ? "aguardando autorização" : "aguardando contraparte";
  return {
    ok: true, changed: true,
    request: {
      id: s.nonce, kind: s.kind, snapshot: s, digest, status, rev: 1, evidence: { digest, consent: [evidence] }, attempts: [], late: null, signature: null,
      cancellation: null, description, createdBy: actor, createdAt: at, updatedAt: at,
      history: [{ from: null, to: "criado", actor, at }, { from: "criado", to: status, actor: SYSTEM, at }],
    },
  };
}

// ---------- input validation ----------

const parseAmount = (v: unknown): string | null => {
  if (typeof v !== "string" || !/^[1-9][0-9]{0,19}$/.test(v)) return null;
  return BigInt(v) <= U64_MAX ? v : null;
};
const parseExpiry = (v: unknown, now: number): string | null => {
  const s = typeof v === "number" && Number.isSafeInteger(v) ? String(v) : v;
  if (typeof s !== "string" || !/^[1-9][0-9]{0,11}$/.test(s)) return null;
  const ms = Number(s) * 1000;
  return ms > now && ms <= now + MAX_EXPIRY_MS ? s : null;
};
function parseDescription(v: unknown): string | null | undefined {
  if (v == null || v === "") return null;
  if (typeof v !== "string") return undefined;
  const d = v.trim();
  return [...d].length <= MAX_DESCRIPTION && !/[\p{Cc}‪-‮⁦-⁩]/u.test(d) ? d || null : undefined;
}
/** Strict shape of a snapshot returned by the client: exactly the 12 keys, each well formed. */
function parseSnapshot(v: unknown): Snapshot | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  if (Object.keys(o).length !== SNAPSHOT_KEYS.length || !SNAPSHOT_KEYS.every((k) => typeof o[k] === "string")) return null;
  const s = o as unknown as Snapshot;
  const keys = [s.genesis, s.programId, s.policy, s.payerAuthority, s.agent, s.mint, s.recipientTokenAccount, s.receiverAuthority];
  if (s.kind !== "charge" && s.kind !== "send") return null;
  if (!keys.every((k) => parsePubkey(k)) || !parseAmount(s.amount) || !/^[0-9a-f]{32}$/.test(s.nonce) || !/^[1-9][0-9]{0,11}$/.test(s.expiry)) return null;
  return s;
}

// ---------- creation (two calls) ----------

type CreateInput = { kind?: unknown; counterparty?: unknown; amount?: unknown; expiry?: unknown; description?: unknown };

async function read(deps: OrgDeps, key: string): Promise<AccountData | null | Fail> {
  try {
    return await deps.readAccount(key);
  } catch {
    return { error: "could not read the account from the chain; try again", status: 503, code: "RPC_ERROR" };
  }
}

/** Every creation precondition (docs/B2B_NETWORK_SPEC.md section 5). Convenience only: the program is what enforces. Pure of the client: all chain-derived fields come from the server. */
async function buildSnapshot(deps: OrgDeps, me: string, kind: Kind, counterparty: unknown, amount: unknown, expiry: unknown, nonce: string): Promise<Snapshot | Fail> {
  const other = parsePubkey(counterparty)?.toBase58();
  if (!other) return bad("counterparty must be a base58 public key", "INVALID_PUBKEY");
  if (other === me) return bad("cannot create a request with yourself", "SELF_REQUEST");
  const amt = parseAmount(amount);
  if (!amt) return bad("amount must be a positive integer in base units, as a decimal string below 2^64", "INVALID_AMOUNT");
  const exp = parseExpiry(expiry, deps.now);
  if (!exp) return bad("expiry must be unix seconds in the future, at most 30 days ahead", "INVALID_EXPIRY");

  const [orgs, connections] = await Promise.all([readOrgs(deps.dir), readCollection<Connection>(deps.dir, CONNECTIONS)]);
  const mine = orgs.find((o) => o.authority === me);
  if (!mine) return { error: "create your organization first", status: 403, code: "NO_ORGANIZATION" };
  const theirs = orgs.find((o) => o.authority === other);
  if (!theirs) return { error: "organization not found", status: 404, code: "NOT_FOUND" };
  if (!connections.some((c) => c.status === "ativa" && ((c.a === me && c.b === other) || (c.a === other && c.b === me)))) {
    return { error: "no active connection with this organization", status: 409, code: "NO_ACTIVE_CONNECTION" };
  }
  const [payer, receiver] = kind === "charge" ? [theirs, mine] : [mine, theirs];
  if (!payer.payerAgent) return bad("the paying organization has no payer agent declared", "NO_PAYER_AGENT");
  if (!receiver.receivingAccount) return bad("the receiving organization has no receiving account", "NO_RECEIVING_ACCOUNT");
  const recipient = await validateReceivingAccount(deps, receiver.receivingAccount.tokenAccount, receiver.authority);
  if ("error" in recipient) return recipient;

  const policy = findPolicyPda(new PublicKey(payer.authority), new PublicKey(payer.payerAgent));
  const policyInfo = await read(deps, policy.toBase58());
  if (policyInfo && "error" in policyInfo) return policyInfo;
  if (!policyInfo) return bad("the payer agent has no policy on this cluster", "POLICY_NOT_FOUND");
  if (policyInfo.owner !== PROGRAM_ID.toBase58() || !Buffer.from(policyInfo.data.subarray(0, 8)).equals(POLICY_DISCRIMINATOR)) return bad("policy account is not a PULSO AgentPolicy", "BAD_POLICY");
  const vault = findVaultPda(policy);
  const vaultInfo = await read(deps, vault.toBase58());
  if (vaultInfo && "error" in vaultInfo) return vaultInfo;
  if (!vaultInfo) return bad("the policy has no vault", "VAULT_NOT_FOUND");
  if (vaultInfo.owner !== TOKEN_PROGRAM_ID || vaultInfo.data.length !== 165 || vaultInfo.data[108] !== 1) return bad("vault is not an initialized token account", "BAD_VAULT");
  if (new PublicKey(vaultInfo.data.slice(0, 32)).toBase58() !== recipient.mint) return bad("the vault mint differs from the receiving account mint", "MINT_MISMATCH");

  return {
    kind, genesis: deps.cluster, programId: PROGRAM_ID.toBase58(), policy: policy.toBase58(), payerAuthority: payer.authority, agent: payer.payerAgent,
    mint: recipient.mint, recipientTokenAccount: recipient.tokenAccount, receiverAuthority: receiver.authority, amount: amt, nonce, expiry: exp,
  };
}

const CREATE_ACTION = { charge: "network.charge.issue", send: "network.send.propose" } as const;

/** Step 1. Nothing is persisted but the challenge. The client signs `message`, then calls `submitRequest` with `snapshot`, `nonce` (the challenge's) and `signature`. */
export async function prepareRequest(deps: OrgDeps, domain: string, me: string, input: CreateInput) {
  if (input.kind !== "charge" && input.kind !== "send") return bad("kind must be charge or send", "INVALID_KIND");
  if (parseDescription(input.description) === undefined) return bad(`description must be at most ${MAX_DESCRIPTION} characters without control characters`, "INVALID_DESCRIPTION");
  const snapshot = await buildSnapshot(deps, me, input.kind, input.counterparty, input.amount, input.expiry, randomBytes(16).toString("hex"));
  if ("error" in snapshot) return snapshot;
  const digest = digestOf(snapshot);
  const challenge = await issueConsentChallenge(deps, domain, me, CREATE_ACTION[input.kind], digest);
  if ("error" in challenge) return { error: challenge.error, status: 400 } as Fail;
  return { kind: input.kind, snapshot, digest, action: CREATE_ACTION[input.kind], ...challenge };
}

/** Step 2. The snapshot is rebuilt on the server and must equal what the client sent; the digest is recomputed and is the only `terms` the consent may carry. */
export async function submitRequest(
  deps: OrgDeps, domain: string, me: string, input: { snapshot?: unknown; description?: unknown; nonce?: unknown; signature?: unknown },
): Promise<RequestOut | Fail> {
  const sent = parseSnapshot(input.snapshot);
  if (!sent) return bad("malformed snapshot", "MALFORMED");
  const description = parseDescription(input.description);
  if (description === undefined) return bad(`description must be at most ${MAX_DESCRIPTION} characters without control characters`, "INVALID_DESCRIPTION");
  const charge = sent.kind === "charge";
  if (me !== (charge ? sent.receiverAuthority : sent.payerAuthority)) return forbidden(charge ? "only the receiver can issue a charge" : "only the payer can propose a send");

  const snapshot = await buildSnapshot(deps, me, sent.kind, charge ? sent.payerAuthority : sent.receiverAuthority, sent.amount, sent.expiry, sent.nonce);
  if ("error" in snapshot) return snapshot;
  if (SNAPSHOT_KEYS.some((k) => snapshot[k] !== sent[k])) return bad("snapshot does not match the server's view of these terms", "SNAPSHOT_MISMATCH");
  const digest = digestOf(snapshot);
  const consent = await verifyConsent(deps, domain, input.nonce, input.signature, { action: CREATE_ACTION[snapshot.kind], terms: digest, authority: me });
  if ("error" in consent) return consent;

  const out = await mutateCollection<B2BRequest, Outcome>(deps.dir, REQUESTS, (items) => {
    if (items.some((x) => x.id === snapshot.nonce)) return { ok: false, fail: { error: "request id already used", status: 409, code: "ID_TAKEN" }, request: null, changed: false };
    const res = applyTransition(null, { type: "create", base: { snapshot, digest, evidence: consent, description } }, me, deps.now);
    if (res.ok) items.push(res.request);
    return res;
  });
  return out.ok ? present(out.request, me, await readOrgs(deps.dir), false) : out.fail;
}

// ---------- accept / decline / cancel ----------

const find = async (dir: string, me: string, id: string) =>
  (await readCollection<B2BRequest>(dir, REQUESTS)).find((r) => r.id === id && (r.snapshot.payerAuthority === me || r.snapshot.receiverAuthority === me));

/** Step 1 of accept: only the receiver, only a proposal still waiting. Same digest as the proposal. */
export async function prepareAccept(deps: AuthDeps, domain: string, me: string, id: string) {
  const found = await find(deps.dir, me, id);
  if (!found) return notFound;
  const r = settleExpiry(found, deps.now);
  if (!digestOk(r)) return digestBroken;
  if (r.kind !== "send" || r.snapshot.receiverAuthority !== me) return forbidden("only the receiver can accept a proposal");
  if (r.status !== "aguardando contraparte") return { ...state(r), current: present(r, me, await readOrgs(deps.dir), false) };
  const challenge = await issueConsentChallenge(deps, domain, me, "network.send.accept", r.digest);
  return "error" in challenge ? ({ error: challenge.error, status: 400 } as Fail) : { id, digest: r.digest, action: "network.send.accept", ...challenge };
}

export async function acceptRequest(deps: AuthDeps, domain: string, me: string, id: string, input: { nonce?: unknown; signature?: unknown }): Promise<RequestOut | Fail> {
  const found = await find(deps.dir, me, id);
  if (!found) return notFound;
  if (!digestOk(found)) return digestBroken;
  if (found.kind !== "send" || found.snapshot.receiverAuthority !== me) return forbidden("only the receiver can accept a proposal");
  const consent = await verifyConsent(deps, domain, input.nonce, input.signature, { action: "network.send.accept", terms: found.digest, authority: me });
  if ("error" in consent) return consent;
  return userAct(deps, me, id, { type: "accept", evidence: consent });
}

export const declineRequest = (deps: AuthDeps, me: string, id: string) => userAct(deps, me, id, { type: "decline" });
/** Editing is cancel + a new request: pass `edited` and the id of the new request (must be one of mine). */
export const cancelRequest = (deps: AuthDeps, me: string, id: string, input: { reason?: unknown; supersededBy?: unknown } = {}) => {
  if (input.reason === undefined && input.supersededBy === undefined) return userAct(deps, me, id, { type: "cancel", reason: "user" });
  if (input.reason !== "edited" || typeof input.supersededBy !== "string" || !/^[0-9a-f]{32}$/.test(input.supersededBy)) {
    return Promise.resolve(bad("reason must be edited with supersededBy set to the new request id", "BAD_CANCEL"));
  }
  return userAct(deps, me, id, { type: "cancel", reason: "edited", supersededBy: input.supersededBy });
};

/** Compare-and-set under the collection lock: the first action wins, a loser gets 409 with the current state. Non-participants get 404. */
async function userAct(deps: AuthDeps, me: string, id: string, event: TransitionEvent): Promise<RequestOut | Fail> {
  const orgs = await readOrgs(deps.dir);
  const out = await mutateCollection<B2BRequest, Outcome>(deps.dir, REQUESTS, (items) => {
    const i = items.findIndex((r) => r.id === id && (r.snapshot.payerAuthority === me || r.snapshot.receiverAuthority === me));
    if (i < 0) return { ok: false, fail: notFound, request: null, changed: false };
    if (event.type === "cancel" && event.supersededBy && !items.some((r) => r.id === event.supersededBy && r.createdBy === me)) {
      return { ok: false, fail: bad("supersededBy is not one of your requests", "BAD_CANCEL"), request: null, changed: false };
    }
    const res = applyTransition(items[i], event, me, deps.now);
    if (res.changed && res.request) items[i] = res.request;
    return res;
  });
  if (out.ok) return present(out.request, me, orgs, false);
  return out.request ? { ...out.fail, current: present(out.request, me, orgs, false) } : out.fail;
}

// ---------- system entry (#310) and disconnect ----------

/**
 * The ONLY way to reach lines 8 and 10-13. For #310 (reconcile) after it read the chain; deliberately
 * not wired to any route. `expectRev` is the compare-and-set: the request must still be at the
 * revision the caller read, else 409. Returns the new request or a Fail.
 */
export interface SystemHooks {
  /** Under the lock, before the event, with the whole collection (e.g. the signature -> request index). A Fail aborts; nothing is written. */
  check?: (items: B2BRequest[]) => Fail | null;
  /** Under the lock, on the transitioned request; what it returns is what gets written, so state and evidence land in ONE write. */
  patch?: (next: B2BRequest) => B2BRequest;
}
export async function systemTransition(deps: { dir: string; now: number }, id: string, event: SystemEvent, expectRev?: number, hooks?: SystemHooks): Promise<B2BRequest | Fail> {
  const out = await mutateCollection<B2BRequest, B2BRequest | Fail>(deps.dir, REQUESTS, (items) => {
    const i = items.findIndex((r) => r.id === id);
    if (i < 0) return notFound;
    if (expectRev !== undefined && items[i].rev !== expectRev) return { error: "request changed; retry", status: 409, code: "CONFLICT", current: items[i] };
    const refused = hooks?.check?.(items);
    if (refused) return refused;
    const res = applyTransition(items[i], event, SYSTEM, deps.now);
    if (res.changed && res.request) items[i] = res.ok && hooks?.patch ? hooks.patch(res.request) : res.request;
    return res.ok ? items[i] : { ...res.fail, current: res.request };
  });
  return out;
}

/** Disconnect: requests between the pair that have no payment sent become `cancelado` (reason `disconnect`); `enviado`/`confirmado` keep reconciling. Idempotent. */
export async function cancelPendingForPair(deps: { dir: string; now: number }, x: string, y: string): Promise<void> {
  await mutateCollection<B2BRequest, void>(deps.dir, REQUESTS, (items) => {
    items.forEach((r, i) => {
      const pair = (r.snapshot.payerAuthority === x && r.snapshot.receiverAuthority === y) || (r.snapshot.payerAuthority === y && r.snapshot.receiverAuthority === x);
      if (!pair) return;
      const res = applyTransition(r, { type: "cancel", reason: "disconnect" }, SYSTEM, deps.now);
      if (res.changed && res.request) items[i] = res.request;
    });
  });
}

// ---------- reads ----------

export interface RequestOut {
  id: string; kind: Kind; status: Status; direction: "sent" | "received"; role: "payer" | "receiver";
  counterparty: PublicOrg | { authority: string }; snapshot: Snapshot; digest: string; preimageHex?: string;
  evidence: B2BRequest["evidence"]; history: Transition[]; attempts: Attempt[]; late: Late | null; signature: string | null;
  cancellation: B2BRequest["cancellation"]; description: string | null; createdAt: string; updatedAt: string; rev: number;
}

function present(r: B2BRequest, me: string, orgs: Organization[], detail: boolean): RequestOut {
  const payer = r.snapshot.payerAuthority === me;
  const other = payer ? r.snapshot.receiverAuthority : r.snapshot.payerAuthority;
  const org = orgs.find((o) => o.authority === other);
  return {
    id: r.id, kind: r.kind, status: r.status, direction: r.createdBy === me ? "sent" : "received", role: payer ? "payer" : "receiver",
    counterparty: org ? publicOrg(org) : { authority: other }, snapshot: r.snapshot, digest: r.digest,
    ...(detail ? { preimageHex: Buffer.from(termsPreimage(toTerms(r.snapshot))).toString("hex") } : {}),
    evidence: r.evidence, history: r.history, attempts: r.attempts, late: r.late, signature: r.signature, cancellation: r.cancellation,
    description: r.description, createdAt: r.createdAt, updatedAt: r.updatedAt, rev: r.rev,
  };
}

/** Only the caller's requests, newest first, with effective (lazily expired) status. `view` filters sent/received. */
export async function listRequests(deps: { dir: string; now: number }, me: string, view?: string | null): Promise<RequestOut[] | Fail> {
  if (view != null && view !== "sent" && view !== "received") return bad("view must be sent or received", "BAD_QUERY");
  const [items, orgs] = await Promise.all([readCollection<B2BRequest>(deps.dir, REQUESTS), readOrgs(deps.dir)]);
  return items
    .filter((r) => r.snapshot.payerAuthority === me || r.snapshot.receiverAuthority === me)
    .map((r) => present(settleExpiry(r, deps.now), me, orgs, false))
    .filter((r) => !view || r.direction === view)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Full detail with the exact preimage. Recomputes the digest and refuses if it diverges from the stored one. Third parties get 404. */
export async function getRequest(deps: { dir: string; now: number }, me: string, id: string): Promise<RequestOut | Fail> {
  const found = await find(deps.dir, me, id);
  if (!found) return notFound;
  if (!digestOk(found)) return digestBroken;
  return present(settleExpiry(found, deps.now), me, await readOrgs(deps.dir), true);
}

export interface AgentPackage {
  version: "pulso-b2b-package-v1"; requestId: string; kind: Kind; status: Status; ready: boolean; digest: string; snapshot: Snapshot;
  consent: { action: string; message: string; signature: string; signer: string; at: string }[];
}

/** Export for the agent (docs/B2B_NETWORK_SPEC.md section 7). Participants only; no private description; `ready` = terms agreed and not yet paid/ended. */
export async function requestPackage(deps: { dir: string; now: number }, me: string, id: string): Promise<AgentPackage | Fail> {
  const found = await find(deps.dir, me, id);
  if (!found) return notFound;
  if (!digestOk(found)) return digestBroken;
  const r = settleExpiry(found, deps.now);
  return {
    version: "pulso-b2b-package-v1", requestId: r.id, kind: r.kind, status: r.status, ready: r.status === "aguardando autorização", digest: r.digest, snapshot: r.snapshot,
    consent: r.evidence.consent.map((c) => ({ action: c.action, message: c.message, signature: c.signature, signer: c.authority, at: c.at })),
  };
}

