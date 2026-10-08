// Thin client for /api/network/*. Pure helpers here are unit-tested; nothing signs or stores keys.
// A connection or a message signature never authorizes spending: the on-chain policy does.
import type { Kind, RequestOut, Status } from "./network-requests"; // types only: erased at build, no server code reaches the client
import { parseUnits } from "./units";
export type { Kind, RequestOut, Snapshot, Status } from "./network-requests";

export interface PublicOrg { handle: string; displayName: string; authority: string }
export interface Side { receivingAccount: string | null; payerAgent: string | null }
export interface Connection {
  id: string;
  status: "pendente" | "ativa" | "recusada" | "cancelada" | "expirada" | "desconectada";
  view: "enviado" | "recebido" | "aceito" | "recusado" | "cancelado" | "expirado" | "desconectado";
  direction: "sent" | "received";
  counterparty: PublicOrg | { authority: string };
  createdAt: string;
  expiresAt: string;
  updatedAt: string;
  snapshot?: { a: Side; b: Side };
}
export interface Prepared { message: string; nonce: string }

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code?: string; error: string };

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<ApiResult<T>> {
  try {
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return { ok: true, data: data as T };
    return { ok: false, status: res.status, code: data.code, error: data.error ?? `request failed (${res.status})` };
  } catch {
    return { ok: false, status: 0, error: "network error; check your connection and try again" };
  }
}

/** The server wants base64 of the 64 signature bytes. */
export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

const BASE58_KEY = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const HANDLE = /^[A-Za-z0-9_]{3,32}$/;

/** One search box: a leading @ is a handle; otherwise a base58 key-shaped string is a key; otherwise a handle. */
export function classifyQuery(input: string): { handle: string } | { authority: string } | { error: string } {
  const text = input.trim();
  if (text.startsWith("@")) {
    const handle = text.slice(1);
    return HANDLE.test(handle) ? { handle } : { error: "A handle has 3-32 letters, digits or underscores." };
  }
  if (BASE58_KEY.test(text)) return { authority: text };
  if (HANDLE.test(text)) return { handle: text };
  return { error: "Enter @handle or a full public key." };
}

const MESSAGES: Record<string, string> = {
  INVALID_HANDLE: "Handle must be 3-32 letters, digits or underscores.",
  RESERVED_HANDLE: "That handle is reserved. Pick another.",
  INVALID_NAME: "Name must be 1-64 characters, without control characters.",
  INVALID_PUBKEY: "That is not a valid public key.",
  BAD_RECEIVING_ACCOUNT: "That token account is not valid for this wallet: it must be an initialized SPL token account owned by your authority key.",
  AGENT_IS_AUTHORITY: "The paying agent must be a different key than your authority key.",
  HANDLE_TAKEN: "That handle is already taken.",
  AUTHORITY_TAKEN: "This wallet already has an organization.",
  RPC_ERROR: "Could not read the account from the chain. Try again in a moment.",
  BAD_QUERY: "Search by one handle or one public key.",
  NOT_FOUND: "No organization found. Handles and keys must match exactly.",
  RATE_LIMITED: "Too many searches. Wait a minute and try again.",
  NO_ORGANIZATION: "Create your organization before inviting.",
  SELF_CONNECTION: "You cannot connect to your own organization.",
  DUPLICATE: "You already have a live connection or invite with this organization.",
  CROSSED: "This organization already invited you. Accept it from your list.",
  STATE: "This changed in the meantime. The list was refreshed.",
  FORBIDDEN: "You cannot do that on this item.",
  CONFLICT: "Your organization changed elsewhere. Reload and retry.",
  INVALID_KIND: "Pick charge or send.",
  INVALID_AMOUNT: "Amount must be a positive number that fits in 64 bits of base units.",
  INVALID_EXPIRY: "Expiry must be in the future and at most 30 days ahead.",
  INVALID_DESCRIPTION: "Description is at most 280 characters, without control characters.",
  SELF_REQUEST: "You cannot create a request with your own organization.",
  NO_ACTIVE_CONNECTION: "You need an active connection with this organization.",
  NO_PAYER_AGENT: "The paying organization has not declared a payer agent yet.",
  NO_RECEIVING_ACCOUNT: "The receiving organization has not declared a receiving account yet.",
  POLICY_NOT_FOUND: "The payer agent has no PULSO policy on this cluster.",
  BAD_POLICY: "The payer agent's policy account is not a PULSO policy.",
  VAULT_NOT_FOUND: "The payer's policy has no vault.",
  BAD_VAULT: "The payer's vault is not a valid token account.",
  MINT_MISMATCH: "The payer's vault and the receiving account use different tokens.",
  SNAPSHOT_MISMATCH: "The terms changed on the server while you were reviewing them. Start again.",
  DIGEST_MISMATCH: "The stored request does not match its digest. Do not rely on it.",
  ID_TAKEN: "This request was already created.",
  BAD_SIGNATURE: "That is not a transaction signature. Paste the base58 signature the agent printed.",
  SIGNATURE_IN_USE: "That transaction is already linked to another request.",
};

/** Plain-language result of a reconciliation code (docs/B2B_NETWORK_SPEC.md section 8). Unknown codes show as they are. */
const RECONCILE_TEXT: Record<string, string> = {
  VERIFIED: "Verified: this transaction matches the terms of this request.",
  PENDING: "Payment reported. Not checked against the chain yet.",
  CONFIRMED_UNVERIFIED: "The transaction exists on-chain, but the full check could not finish (the RPC was unavailable). Try again in a moment.",
  TX_NOT_FOUND: "The transaction is not visible on-chain yet. Wait a few seconds and try again.",
  BELOW_COMMITMENT: "The transaction was seen but has not reached the required commitment yet. Try again shortly.",
  RPC_ERROR: "The chain could not be read. Nothing was decided; try again.",
  LATE_RECORDED: "A payment after the request ended was recorded. The request state did not change.",
  DUPLICATE_RECORDED: "A second matching payment was recorded for this request. The first one already settled it; the money left twice.",
  TX_FAILED: "The transaction failed on-chain, so no money moved.",
  AMOUNT_NOT_EXACT: "The transaction paid a different amount than this request. It must match exactly.",
  SNAPSHOT_MISMATCH: "The transaction does not match the agreed terms.",
  CLUSTER_MISMATCH: "This server's RPC is on a different cluster than the one this request was made for.",
  SIGNATURE_IN_USE: "That transaction is already linked to another request.",
  NOT_PULSO_TRANSFER: "That transaction is not a PULSO transfer.",
  NONCE_MISMATCH: "The transaction does not carry this request's nonce.",
  RECIPIENT_MISMATCH: "The transaction paid a different token account than the one in this request.",
  MINT_MISMATCH: "The transaction paid a different token than this request.",
  AMOUNT_TOO_LOW: "The transaction paid less than this request.",
  BALANCE_MISMATCH: "The recipient balance did not grow by the amount paid.",
  POLICY_INVALID: "The policy behind the transaction is not a valid PULSO policy.",
  AUTHORITY_NOT_ACCEPTED: "The transaction was authorized by a different human than the payer in this request.",
  INTENT_INVALID: "The approval (intent) behind the transaction is not valid.",
  HASH_MISMATCH: "The approval does not match what the transaction paid.",
};
export const reconcileText = (code: string) => RECONCILE_TEXT[code] ?? code;
/** What a participant's POST returned beside the request; see app/lib/network-reconcile.ts. */
export type { Reconcile, ReconcileOut } from "./network-reconcile";

export const errorMessage = (r: { status: number; code?: string; error: string }) =>
  (r.code && MESSAGES[r.code]) || (r.status === 401 ? "Sign-in required or expired. Sign in again." : r.error);

export type Group = "pending-in" | "pending-out" | "connected" | "closed";
const GROUP: Record<Connection["view"], Group> = {
  recebido: "pending-in", enviado: "pending-out", aceito: "connected",
  recusado: "closed", cancelado: "closed", expirado: "closed", desconectado: "closed",
};
export const groupOf = (c: Connection): Group => GROUP[c.view];

/** Plain-language state: text, never only color. */
export const VIEW_LABEL: Record<Connection["view"], string> = {
  recebido: "Invite received", enviado: "Invite sent", aceito: "Connected",
  recusado: "Declined", cancelado: "Cancelled", expirado: "Expired", desconectado: "Disconnected",
};

// ---------- requests (docs/B2B_NETWORK_SPEC.md): application state, never spending authorization ----------

/** Plain-language state: text, never only color. */
export const STATUS_LABEL: Record<Status, string> = {
  "aguardando contraparte": "Waiting for the other organization",
  "aguardando autorização": "Terms agreed, payment not made yet",
  enviado: "Payment reported, not confirmed",
  confirmado: "Payment confirmed on-chain, not verified",
  verificado: "Verified",
  recusado: "Declined",
  expirado: "Expired",
  cancelado: "Cancelled",
};
/** The only green state is `verificado`. */
export const isGreen = (s: Status) => s === "verificado";
export const statusClass = (s: Status) => `net-status-${s === "aguardando contraparte" ? "wait" : s === "aguardando autorização" ? "auth" : s}`;
export const KIND_LABEL: Record<Kind, string> = { charge: "Payment request", send: "Proposed payment" };

export type RequestAction = "accept" | "decline" | "cancel";
/** Who can do what, mirroring the server table (lines 4-7). The server decides; this only hides buttons that would fail. */
export function actionsFor(r: Pick<RequestOut, "role" | "kind" | "status" | "direction">): RequestAction[] {
  const out: RequestAction[] = [];
  const active = r.status === "aguardando contraparte" || r.status === "aguardando autorização";
  if (r.kind === "send" && r.status === "aguardando contraparte" && r.role === "receiver") out.push("accept", "decline");
  if (r.kind === "charge" && r.status === "aguardando autorização" && r.role === "payer") out.push("decline");
  if (active && r.direction === "sent") out.push("cancel");
  return out;
}

/** "12.5" with 6 decimals -> "12500000". Zero is refused. No floats. */
export function amountToBase(input: string, decimals: number): { base: string } | { error: string } {
  const p = parseUnits(input, decimals);
  if ("error" in p) return p;
  if (p.value === 0n) return { error: "Amount must be above zero." };
  if (p.value >= 1n << 64n) return { error: "Amount is too large." };
  return { base: p.value.toString() };
}

/** SPL mint account: decimals = byte 44 of an 82-byte layout. Null when the shape is wrong. */
export const mintDecimals = (mintData: Uint8Array): number | null => (mintData.length >= 82 ? mintData[44] : null);

export const DURATIONS = [
  { id: "1h", label: "1 hour", seconds: 3600 },
  { id: "1d", label: "24 hours", seconds: 86400 },
  { id: "7d", label: "7 days", seconds: 7 * 86400 },
  { id: "14d", label: "14 days", seconds: 14 * 86400 },
] as const;
export const expiryFrom = (nowMs: number, seconds: number) => String(Math.floor(nowMs / 1000) + seconds);
export const unixToUtc = (unix: string) => new Date(Number(unix) * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
