// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: a connection means two organizations recognized each other in the app. It does
// NOT authorize spending; enforcement stays in the on-chain program. Invite and accept are wallet
// message signatures (not transactions); decline, cancel and disconnect need session + Origin only.
// Disconnecting cancels the pair's requests that have no payment sent yet (network-requests.ts), right after the state change.
import { issueConsentChallenge, parsePubkey, verifyConsent, type AuthDeps, type ConsentEvidence } from "./network-auth";
import { cancelPendingForPair } from "./network-requests";
import { mutateCollection, newId, readCollection, type Fail } from "./network-store";
import { normalizeHandle, publicOrg, readOrgs, type Organization, type PublicOrg } from "./network-store-orgs";

export const CONNECTION_TTL_MS = 7 * 24 * 3_600_000;
export const CONNECTIONS = "connections";

export type ConnectionStatus = "pendente" | "ativa" | "recusada" | "cancelada" | "expirada" | "desconectada";
export interface Side { receivingAccount: string | null; payerAgent: string | null }
export interface Connection {
  id: string;
  a: string; // inviter authority
  b: string; // invited authority
  status: ConnectionStatus;
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  evidence: { invite: ConsentEvidence; accept?: ConsentEvidence };
  snapshot?: { a: Side; b: Side }; // informational, taken at accept
  rev: number;
}

export type ConnectionView = "enviado" | "recebido" | "aceito" | "recusado" | "cancelado" | "expirado" | "desconectado";
export interface ConnectionOut {
  id: string;
  status: ConnectionStatus;
  view: ConnectionView;
  direction: "sent" | "received";
  counterparty: PublicOrg | { authority: string };
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  snapshot?: { a: Side; b: Side };
  evidence: Connection["evidence"];
  rev: number;
}

const termsOf = (c: { a: string; b: string; id: string }) => `pulso-connection-v1:${c.a}:${c.b}:${c.id}`;
const iso = (ms: number) => new Date(ms).toISOString();
const live = (c: Connection) => c.status === "pendente" || c.status === "ativa";
const samePair = (c: Connection, x: string, y: string) => (c.a === x && c.b === y) || (c.a === y && c.b === x);
const notFound: Fail = { error: "connection not found", status: 404, code: "NOT_FOUND" };

/** Lazy expiry: evaluated on read and on write; the write path persists it. */
function expire(c: Connection, now: number): void {
  if (c.status === "pendente" && Date.parse(c.expiresAt) <= now) { c.status = "expirada"; c.updatedAt = iso(now); c.rev += 1; }
}
const effective = (c: Connection, now: number): Connection =>
  c.status === "pendente" && Date.parse(c.expiresAt) <= now ? { ...c, status: "expirada" } : c;

const VIEW: Record<ConnectionStatus, ConnectionView> = {
  pendente: "enviado", ativa: "aceito", recusada: "recusado", cancelada: "cancelado", expirada: "expirado", desconectada: "desconectado",
};

function present(c: Connection, me: string, orgs: Organization[]): ConnectionOut {
  const sent = c.a === me;
  const other = sent ? c.b : c.a;
  const org = orgs.find((o) => o.authority === other);
  return {
    id: c.id, status: c.status,
    view: c.status === "pendente" && !sent ? "recebido" : VIEW[c.status],
    direction: sent ? "sent" : "received",
    counterparty: org ? publicOrg(org) : { authority: other },
    createdAt: c.createdAt, expiresAt: c.expiresAt, updatedAt: c.updatedAt, snapshot: c.snapshot, evidence: c.evidence, rev: c.rev,
  };
}

const conflict = (c: Connection, me: string, orgs: Organization[], error: string, code: string): Fail =>
  ({ error, status: 409, code, current: present(c, me, orgs) });

// ---------- invite ----------

/** Step 1: validate and issue the `network.connect.invite` challenge. The id is chosen here and bound into `terms`. */
export async function prepareInvite(deps: AuthDeps, domain: string, me: string, query: { handle?: string | null; authority?: string | null }) {
  const orgs = await readOrgs(deps.dir);
  if (!orgs.some((o) => o.authority === me)) return { error: "create your organization first", status: 403, code: "NO_ORGANIZATION" } as Fail;
  let target: Organization | undefined;
  if (query.authority != null) {
    const key = parsePubkey(query.authority);
    if (!key) return { error: "authority must be a base58 public key", status: 400, code: "INVALID_PUBKEY" } as Fail;
    target = orgs.find((o) => o.authority === key.toBase58());
  } else {
    const h = normalizeHandle(query.handle);
    target = h ? orgs.find((o) => o.handle === h) : undefined;
  }
  if (!target) return { error: "organization not found", status: 404, code: "NOT_FOUND" } as Fail;
  if (target.authority === me) return { error: "cannot connect to yourself", status: 400, code: "SELF_CONNECTION" } as Fail;
  const existing = (await readCollection<Connection>(deps.dir, CONNECTIONS)).map((c) => effective(c, deps.now)).find((c) => live(c) && samePair(c, me, target.authority));
  if (existing) return conflictPair(existing, me, orgs);
  const id = newId();
  const terms = termsOf({ a: me, b: target.authority, id });
  const challenge = await issueConsentChallenge(deps, domain, me, "network.connect.invite", terms);
  if ("error" in challenge) return { error: challenge.error, status: 400 } as Fail;
  return { id, terms, target: publicOrg(target), ...challenge };
}

const conflictPair = (c: Connection, me: string, orgs: Organization[]) =>
  conflict(c, me, orgs, c.a === me ? "a connection with this organization already exists" : "this organization already invited you", c.a === me ? "DUPLICATE" : "CROSSED");

/** Step 2: the client returns what it signed. `id` and `target` only reconstruct the expected terms; the signature must match the stored challenge. */
export async function submitInvite(
  deps: AuthDeps, domain: string, me: string, input: { id?: unknown; target?: unknown; nonce?: unknown; signature?: unknown },
): Promise<ConnectionOut | Fail> {
  const target = parsePubkey(input.target)?.toBase58();
  if (!target || typeof input.id !== "string" || !/^[0-9a-f]{32}$/.test(input.id)) return { error: "malformed invite", status: 400 };
  if (target === me) return { error: "cannot connect to yourself", status: 400, code: "SELF_CONNECTION" };
  const id = input.id;
  const consent = await verifyConsent(deps, domain, input.nonce, input.signature, { action: "network.connect.invite", terms: termsOf({ a: me, b: target, id }), authority: me });
  if ("error" in consent) return consent;
  const orgs = await readOrgs(deps.dir);
  if (!orgs.some((o) => o.authority === me) || !orgs.some((o) => o.authority === target)) return { error: "organization not found", status: 404, code: "NOT_FOUND" };
  const connection: Connection = {
    id, a: me, b: target, status: "pendente", createdAt: iso(deps.now), expiresAt: iso(deps.now + CONNECTION_TTL_MS), updatedAt: iso(deps.now),
    evidence: { invite: consent }, rev: 1,
  };
  const out = await mutateCollection<Connection, Connection | Fail>(deps.dir, CONNECTIONS, (items) => {
    items.forEach((c) => expire(c, deps.now));
    if (items.some((c) => c.id === id)) return { error: "invite id already used", status: 409, code: "ID_TAKEN" };
    const existing = items.find((c) => live(c) && samePair(c, me, target));
    if (existing) return conflictPair(existing, me, orgs);
    items.push(connection);
    return connection;
  });
  return "error" in out ? out : present(out, me, orgs);
}

// ---------- accept / decline / cancel / disconnect ----------

/** Step 1 of accept: only the invited authority, only while pending. Same terms string as the invite. */
export async function prepareAccept(deps: AuthDeps, domain: string, me: string, id: string) {
  const found = (await readCollection<Connection>(deps.dir, CONNECTIONS)).find((c) => c.id === id && (c.a === me || c.b === me));
  if (!found) return notFound;
  if (found.b !== me) return { error: "only the invited organization can accept", status: 403, code: "FORBIDDEN" } as Fail;
  const c = effective(found, deps.now);
  if (c.status !== "pendente") return conflict(c, me, await readOrgs(deps.dir), `connection is ${c.status}`, "STATE");
  const challenge = await issueConsentChallenge(deps, domain, me, "network.connect.accept", termsOf(c));
  return "error" in challenge ? ({ error: challenge.error, status: 400 } as Fail) : { id, terms: termsOf(c), ...challenge };
}

export async function accept(deps: AuthDeps, domain: string, me: string, id: string, input: { nonce?: unknown; signature?: unknown }): Promise<ConnectionOut | Fail> {
  const found = (await readCollection<Connection>(deps.dir, CONNECTIONS)).find((c) => c.id === id && (c.a === me || c.b === me));
  if (!found) return notFound;
  if (found.b !== me) return { error: "only the invited organization can accept", status: 403, code: "FORBIDDEN" };
  const consent = await verifyConsent(deps, domain, input.nonce, input.signature, { action: "network.connect.accept", terms: termsOf(found), authority: me });
  if ("error" in consent) return consent;
  return transition(deps, me, id, "accept", consent);
}

export const decline = (deps: AuthDeps, me: string, id: string) => transition(deps, me, id, "decline");
export const cancel = (deps: AuthDeps, me: string, id: string) => transition(deps, me, id, "cancel");
export const disconnect = (deps: AuthDeps, me: string, id: string) => transition(deps, me, id, "disconnect");

const RULES = {
  accept: { from: "pendente", to: "ativa", who: "b" },
  decline: { from: "pendente", to: "recusada", who: "b" },
  cancel: { from: "pendente", to: "cancelada", who: "a" },
  disconnect: { from: "ativa", to: "desconectada", who: "either" },
} as const;

/** Compare-and-set under the collection lock: the first action wins, a loser gets 409 with the current state. Repeating an applied action is a 200. Non-participants get 404. */
async function transition(deps: AuthDeps, me: string, id: string, act: keyof typeof RULES, consent?: ConsentEvidence): Promise<ConnectionOut | Fail> {
  const orgs = await readOrgs(deps.dir);
  const rule = RULES[act];
  const out = await mutateCollection<Connection, Connection | Fail>(deps.dir, CONNECTIONS, (items) => {
    const c = items.find((x) => x.id === id && (x.a === me || x.b === me));
    if (!c) return notFound;
    if (rule.who !== "either" && c[rule.who] !== me) return { error: `only the ${rule.who === "a" ? "inviting" : "invited"} organization can ${act}`, status: 403, code: "FORBIDDEN" };
    expire(c, deps.now);
    if (c.status === rule.to) return c; // idempotent
    if (c.status !== rule.from) return conflict(c, me, orgs, `connection is ${c.status}`, "STATE");
    c.status = rule.to;
    c.updatedAt = iso(deps.now);
    c.rev += 1;
    if (act === "accept") {
      c.evidence.accept = consent;
      const side = (authority: string): Side => {
        const o = orgs.find((x) => x.authority === authority);
        return { receivingAccount: o?.receivingAccount?.tokenAccount ?? null, payerAgent: o?.payerAgent ?? null };
      };
      c.snapshot = { a: side(c.a), b: side(c.b) };
    }
    return c;
  });
  if (!("error" in out) && act === "disconnect") await cancelPendingForPair(deps, out.a, out.b); // also on a repeated call: heals a crash between the two writes
  return "error" in out ? out : present(out, me, orgs);
}

// ---------- list ----------

/** Only the caller's connections. The inviter's cancelled invites show; the invitee's vanish. */
export async function listConnections(deps: { dir: string; now: number }, me: string): Promise<ConnectionOut[]> {
  const [items, orgs] = await Promise.all([readCollection<Connection>(deps.dir, CONNECTIONS), readOrgs(deps.dir)]);
  return items
    .filter((c) => (c.a === me || c.b === me) && !(c.status === "cancelada" && c.b === me))
    .map((c) => present(effective(c, deps.now), me, orgs))
    .sort((x, y) => y.createdAt.localeCompare(x.createdAt));
}
