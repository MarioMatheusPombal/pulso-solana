// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: an organization is a self-declared name bound to a wallet that signed a login.
// It does NOT authorize spending; enforcement stays in the on-chain program. Handle and name are
// unverified claims, so the full authority key must always be shown beside them (docs/B2B_NETWORK_SPEC.md section 3).
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "./config";
import { defaultDeps, parsePubkey, type AuthDeps } from "./network-auth";
import { mutateCollection, newId, readCollection, type Fail } from "./network-store";

export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const RESERVED = new Set(["pulso", "admin", "support", "official", "system"]);

export interface AccountData { owner: string; data: Uint8Array }
/** getAccountInfo-like: null when the account does not exist; throws when the RPC is down. */
export type AccountReader = (pubkey: string) => Promise<AccountData | null>;
export interface OrgDeps extends AuthDeps { readAccount: AccountReader }

export interface ReceivingAccount { tokenAccount: string; mint: string; owner: string; checkedAt: string }
export interface Organization {
  id: string;
  handle: string;
  displayName: string;
  authority: string;
  receivingAccount: ReceivingAccount | null;
  receivingAccountHistory: ReceivingAccount[];
  payerAgent: string | null;
  createdAt: string;
  rev: number;
}
/** The only thing a search may reveal. */
export interface PublicOrg { handle: string; displayName: string; authority: string }

export const ORGS = "organizations";
export const publicOrg = (o: Organization): PublicOrg => ({ handle: o.handle, displayName: o.displayName, authority: o.authority });
export const readOrgs = (dir: string) => readCollection<Organization>(dir, ORGS);

export async function defaultOrgDeps(): Promise<OrgDeps> {
  const connection = new Connection(RPC_URL, "confirmed");
  return {
    ...(await defaultDeps()),
    readAccount: async (pubkey) => {
      const info = await connection.getAccountInfo(new PublicKey(pubkey), "confirmed");
      return info && { owner: info.owner.toBase58(), data: info.data };
    },
  };
}

// ---------- validation ----------

/** docs/B2B_NETWORK_SPEC.md section 3, in order: trim, one leading @, reject any non-ASCII (no Unicode folding), lowercase, pattern. */
export function normalizeHandle(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let h = input.trim();
  if (h.startsWith("@")) h = h.slice(1);
  if ([...h].some((c) => c.codePointAt(0)! > 0x7f)) return null;
  h = h.toLowerCase();
  return /^[a-z0-9_]{3,32}$/.test(h) ? h : null;
}

export function validDisplayName(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const name = input.trim();
  const length = [...name].length;
  if (length < 1 || length > 64 || /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u.test(name)) return null;
  return name;
}

/**
 * docs/B2B_NETWORK_SPEC.md section 2. Legacy Token program, 165 bytes, initialized, owner field == authority.
 * SPL layout: mint 0..32, owner 32..64, state byte 108 (1 = initialized). RPC failure refuses.
 * A point-in-time check: SetAuthority can change the owner later.
 */
export async function validateReceivingAccount(deps: OrgDeps, tokenAccount: unknown, authority: string): Promise<ReceivingAccount | Fail> {
  const key = parsePubkey(tokenAccount);
  if (!key) return { error: "receivingAccount must be a base58 public key", status: 400, code: "INVALID_PUBKEY" };
  let info: AccountData | null;
  try {
    info = await deps.readAccount(key.toBase58());
  } catch {
    return { error: "could not read the account from the chain; try again", status: 503, code: "RPC_ERROR" };
  }
  const bad = (error: string): Fail => ({ error, status: 400, code: "BAD_RECEIVING_ACCOUNT" });
  if (!info) return bad("token account not found");
  if (info.owner !== TOKEN_PROGRAM_ID) return bad("account is not owned by the Token program");
  if (info.data.length !== 165) return bad("account is not a 165-byte token account");
  if (info.data[108] !== 1) return bad("token account is not initialized");
  const owner = new PublicKey(info.data.slice(32, 64)).toBase58();
  if (owner !== authority) return bad("token account owner is not the organization authority");
  return { tokenAccount: key.toBase58(), mint: new PublicKey(info.data.slice(0, 32)).toBase58(), owner, checkedAt: new Date(deps.now).toISOString() };
}

// ---------- operations ----------

/** The authority comes from the session, never from the body. Optional fields are validated on the chain / as keys when present. */
export async function createOrganization(
  deps: OrgDeps, authority: string, input: { handle?: unknown; displayName?: unknown; receivingAccount?: unknown; payerAgent?: unknown },
): Promise<Organization | Fail> {
  const handle = normalizeHandle(input.handle);
  if (!handle) return { error: "handle must be 3-32 ASCII letters, digits or underscore", status: 400, code: "INVALID_HANDLE" };
  if (RESERVED.has(handle)) return { error: "handle is reserved", status: 400, code: "RESERVED_HANDLE" };
  const displayName = validDisplayName(input.displayName);
  if (!displayName) return { error: "displayName must be 1-64 characters without control characters", status: 400, code: "INVALID_NAME" };
  let payerAgent: string | null = null;
  if (input.payerAgent != null) {
    payerAgent = parsePubkey(input.payerAgent)?.toBase58() ?? null;
    if (!payerAgent) return { error: "payerAgent must be a base58 public key", status: 400, code: "INVALID_PUBKEY" };
    if (payerAgent === authority) return { error: "payerAgent must differ from the organization authority", status: 400, code: "AGENT_IS_AUTHORITY" };
  }
  let receivingAccount: ReceivingAccount | null = null;
  if (input.receivingAccount != null) {
    const checked = await validateReceivingAccount(deps, input.receivingAccount, authority);
    if ("error" in checked) return checked;
    receivingAccount = checked;
  }
  const org: Organization = {
    id: newId(), handle, displayName, authority, receivingAccount, receivingAccountHistory: [], payerAgent,
    createdAt: new Date(deps.now).toISOString(), rev: 1,
  };
  return mutateCollection<Organization, Organization | Fail>(deps.dir, ORGS, (items) => {
    if (items.some((o) => o.authority === authority)) return { error: "this authority already has an organization", status: 409, code: "AUTHORITY_TAKEN" };
    if (items.some((o) => o.handle === handle)) return { error: "handle is taken", status: 409, code: "HANDLE_TAKEN" };
    items.push(org);
    return org;
  });
}

export async function getOwnOrganization(deps: { dir: string }, authority: string): Promise<Organization | Fail> {
  return (await readOrgs(deps.dir)).find((o) => o.authority === authority) ?? { error: "organization not found", status: 404, code: "NOT_FOUND" };
}

/** Handle and authority never change. A new receiving account keeps the previous one in history. `null` clears. */
export async function updateOrganization(
  deps: OrgDeps, authority: string, input: { receivingAccount?: unknown; payerAgent?: unknown },
): Promise<Organization | Fail> {
  const current = await getOwnOrganization(deps, authority);
  if ("error" in current) return current;
  let receivingAccount: ReceivingAccount | null | undefined;
  if (input.receivingAccount === null) receivingAccount = null;
  else if (input.receivingAccount !== undefined) {
    const checked = await validateReceivingAccount(deps, input.receivingAccount, authority);
    if ("error" in checked) return checked;
    receivingAccount = checked;
  }
  let payerAgent: string | null | undefined;
  if (input.payerAgent === null) payerAgent = null;
  else if (input.payerAgent !== undefined) {
    payerAgent = parsePubkey(input.payerAgent)?.toBase58();
    if (!payerAgent) return { error: "payerAgent must be a base58 public key", status: 400, code: "INVALID_PUBKEY" };
    if (payerAgent === authority) return { error: "payerAgent must differ from the organization authority", status: 400, code: "AGENT_IS_AUTHORITY" };
  }
  return mutateCollection<Organization, Organization | Fail>(deps.dir, ORGS, (items) => {
    const org = items.find((o) => o.authority === authority);
    if (!org) return { error: "organization not found", status: 404, code: "NOT_FOUND" };
    if (org.rev !== current.rev) return { error: "organization changed; retry", status: 409, code: "CONFLICT" };
    if (receivingAccount !== undefined) {
      if (org.receivingAccount && org.receivingAccount.tokenAccount !== receivingAccount?.tokenAccount) org.receivingAccountHistory.push(org.receivingAccount);
      org.receivingAccount = receivingAccount;
    }
    if (payerAgent !== undefined) org.payerAgent = payerAgent;
    org.rev += 1;
    return org;
  });
}

// ---------- exact search ----------

/** Exactly one of `handle` / `authority`. Exact match only; no prefix, no list. Distinct errors: INVALID_PUBKEY, NOT_FOUND. */
export async function findOrganization(deps: { dir: string }, query: { handle?: string | null; authority?: string | null }): Promise<PublicOrg | Fail> {
  const { handle, authority } = query;
  if ((handle != null) === (authority != null)) return { error: "pass exactly one of handle or authority", status: 400, code: "BAD_QUERY" };
  let match: Organization | undefined;
  if (authority != null) {
    const key = parsePubkey(authority);
    if (!key) return { error: "authority must be a base58 public key", status: 400, code: "INVALID_PUBKEY" };
    match = (await readOrgs(deps.dir)).find((o) => o.authority === key.toBase58());
  } else {
    const h = normalizeHandle(handle);
    if (!h) return { error: "no organization with this handle", status: 404, code: "NOT_FOUND" };
    match = (await readOrgs(deps.dir)).find((o) => o.handle === h);
  }
  return match ? publicOrg(match) : { error: "organization not found", status: 404, code: "NOT_FOUND" };
}

const searches = new Map<string, number[]>();
/** Anti-enumeration: 30 searches per minute per authority, in memory (one process). */
export function allowSearch(authority: string, now: number, limit = 30): boolean {
  const recent = (searches.get(authority) ?? []).filter((t) => now - t < 60_000);
  if (recent.length >= limit) { searches.set(authority, recent); return false; }
  recent.push(now);
  searches.set(authority, recent);
  return true;
}
