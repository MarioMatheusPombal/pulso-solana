// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Trust boundary: a network session proves "this wallet signed a login challenge". It is NOT
// spending authorization; enforcement stays in the on-chain program. The backend only ever sees
// a pubkey, a message and a signature, never a private key.
import { createHash, createPublicKey, randomBytes, randomUUID, verify as edVerify } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Connection, PublicKey } from "@solana/web3.js";
import { RPC_URL } from "./config";

export const SESSION_COOKIE = "pulso_network_session";
export const CHALLENGE_TTL_MS = 5 * 60_000;
export const SESSION_TTL_MS = 8 * 3_600_000;

/** Everything impure is injected so tests need no network, clock or real directory. */
export interface AuthDeps {
  dir: string;
  cluster: string; // genesis hash, base58
  now: number; // epoch ms
}

export interface Session {
  authority: string;
  cluster: string;
  expiresAt: string;
}

// `action`/`terms` are set only on consent challenges; a login record has neither.
interface NonceRecord { authority: string; domain: string; cluster: string; issued: number; expires: number; action?: string; terms?: string }
interface SessionRecord { authority: string; cluster: string; expires: number }
type State = { version: 1; nonces: Record<string, NonceRecord>; sessions: Record<string, SessionRecord> };

// ---------- message ----------

export function loginMessage(r: { domain: string; authority: string; cluster: string; nonce: string; issued: number; expires: number }): string {
  return [
    "PULSO network sign-in",
    "NOT A TRANSACTION · grants no spending authority",
    `domain: ${r.domain}`,
    "action: network.login",
    `authority: ${r.authority}`,
    `cluster: ${r.cluster}`,
    `nonce: ${r.nonce}`,
    `issued: ${new Date(r.issued).toISOString()}`,
    `expires: ${new Date(r.expires).toISOString()}`,
  ].join("\n");
}

/** Actions a commercial consent may sign (docs/B2B_NETWORK_SPEC.md section 4). Login is not one of them. */
export const CONSENT_ACTIONS = ["network.connect.invite", "network.connect.accept", "network.charge.issue", "network.send.propose", "network.send.accept"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

export function consentMessage(r: { domain: string; action: string; authority: string; cluster: string; terms: string; nonce: string; issued: number; expires: number }): string {
  return [
    "PULSO network consent",
    "NOT A TRANSACTION · grants no spending authority",
    `domain: ${r.domain}`,
    `action: ${r.action}`,
    `authority: ${r.authority}`,
    `cluster: ${r.cluster}`,
    `terms: ${r.terms}`,
    `nonce: ${r.nonce}`,
    `issued: ${new Date(r.issued).toISOString()}`,
    `expires: ${new Date(r.expires).toISOString()}`,
  ].join("\n");
}

// ---------- ed25519 (stdlib) ----------

const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");

function verifyEd25519(pubkey: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, pubkey]), format: "der", type: "spki" });
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

export function parsePubkey(input: unknown): PublicKey | null {
  if (typeof input !== "string" || input.length < 32 || input.length > 44) return null;
  try {
    const key = new PublicKey(input);
    return key.toBase58() === input ? key : null;
  } catch {
    return null;
  }
}

// ---------- file store (same lock + atomic rename pattern as waitlist-store) ----------

const statePath = (dir: string) => join(dir, "auth.json");
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function defaultDir() {
  return process.env.PULSO_NETWORK_DIR || join(process.cwd(), ".data", "network");
}

async function readState(path: string): Promise<State> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as State;
    if (parsed.version !== 1) throw new Error("unsupported network auth storage format");
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { version: 1, nonces: {}, sessions: {} };
    throw error;
  }
}

async function acquireLock(path: string) {
  const lockPath = `${path}.lock`;
  await mkdir(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 200; attempt += 1) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      return async () => {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        if (Date.now() - (await stat(lockPath)).mtimeMs > 60_000) await unlink(lockPath);
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code !== "ENOENT") throw statError;
      }
      await delay(10);
    }
  }
  throw new Error("network auth storage is busy; try again");
}

/** Read-modify-write under lock. Always persists, so a consumed nonce stays consumed even when the caller then fails. Expired records are dropped here (lazy cleanup). */
async function mutate<T>(deps: AuthDeps, fn: (state: State) => T): Promise<T> {
  const path = statePath(deps.dir);
  const release = await acquireLock(path);
  try {
    const state = await readState(path);
    const result = fn(state);
    for (const [k, v] of Object.entries(state.nonces)) if (v.expires <= deps.now) delete state.nonces[k];
    for (const [k, v] of Object.entries(state.sessions)) if (v.expires <= deps.now) delete state.sessions[k];
    const tmp = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, JSON.stringify(state), { encoding: "utf8", mode: 0o600 });
      await rename(tmp, path);
    } finally {
      await unlink(tmp).catch(() => undefined);
    }
    return result;
  } finally {
    await release();
  }
}

// ---------- challenge / verify / session ----------

export async function issueChallenge(deps: AuthDeps, domain: string, authorityInput: unknown) {
  const authority = parsePubkey(authorityInput);
  if (!authority) return { error: "authority must be a base58 public key" as const };
  const nonce = randomBytes(32).toString("base64url");
  const record: NonceRecord = { authority: authority.toBase58(), domain, cluster: deps.cluster, issued: deps.now, expires: deps.now + CHALLENGE_TTL_MS };
  await mutate(deps, (s) => { s.nonces[nonce] = record; });
  return { message: loginMessage({ ...record, nonce }), nonce, expiresAt: new Date(record.expires).toISOString() };
}

export type VerifyResult = { token: string; session: Session } | { error: string; status: 400 | 401 };

/** `signature` is base64 (64 bytes). `domain` is the host of the verify request. The message is rebuilt from the stored record, never from the client. */
export async function verifyChallenge(deps: AuthDeps, domain: string, nonce: unknown, signature: unknown): Promise<VerifyResult> {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return { error: "malformed nonce", status: 400 };
  if (typeof signature !== "string" || signature.length > 100) return { error: "malformed signature", status: 400 };
  const sig = Buffer.from(signature, "base64");
  if (sig.length !== 64) return { error: "malformed signature", status: 400 };

  const fail = { error: "sign-in failed", status: 401 } as const;
  return mutate(deps, (s): VerifyResult => {
    const record = s.nonces[nonce];
    delete s.nonces[nonce]; // consumed on first attempt, valid or not
    if (!record || record.action || record.expires <= deps.now) return fail; // a consent challenge never logs in
    if (record.domain !== domain || record.cluster !== deps.cluster) return fail;
    const message = Buffer.from(loginMessage({ ...record, nonce }), "utf8");
    if (!verifyEd25519(new PublicKey(record.authority).toBytes(), message, sig)) return fail;

    const token = randomBytes(32).toString("base64url");
    const expires = deps.now + SESSION_TTL_MS;
    s.sessions[sha256(token)] = { authority: record.authority, cluster: record.cluster, expires };
    return { token, session: { authority: record.authority, cluster: record.cluster, expiresAt: new Date(expires).toISOString() } };
  });
}

/** What a consent leaves behind: the exact signed message plus who/what/when. Proves app-level consent only; spends nothing. */
export interface ConsentEvidence { action: ConsentAction; terms: string; authority: string; message: string; signature: string; at: string }

export async function issueConsentChallenge(deps: AuthDeps, domain: string, authorityInput: unknown, action: unknown, terms: unknown) {
  const authority = parsePubkey(authorityInput);
  if (!authority) return { error: "authority must be a base58 public key" as const };
  if (!CONSENT_ACTIONS.includes(action as ConsentAction)) return { error: "unsupported consent action" as const };
  if (typeof terms !== "string" || !/^[\x21-\x7E]{1,200}$/.test(terms)) return { error: "malformed terms" as const };
  const nonce = randomBytes(32).toString("base64url");
  const record: NonceRecord = { authority: authority.toBase58(), domain, cluster: deps.cluster, issued: deps.now, expires: deps.now + CHALLENGE_TTL_MS, action: action as string, terms };
  await mutate(deps, (s) => { s.nonces[nonce] = record; });
  return { message: consentMessage({ ...record, action: action as string, terms, nonce }), nonce, expiresAt: new Date(record.expires).toISOString() };
}

export type ConsentResult = ConsentEvidence | { error: string; status: 400 | 401 };

/** Same one-shot nonce as login. `expected` is what the CALLER requires; the stored record must match it exactly, so a login challenge or another action's consent never passes. */
export async function verifyConsent(
  deps: AuthDeps, domain: string, nonce: unknown, signature: unknown,
  expected: { action: ConsentAction; terms: string; authority: string },
): Promise<ConsentResult> {
  if (typeof nonce !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(nonce)) return { error: "malformed nonce", status: 400 };
  if (typeof signature !== "string" || signature.length > 100) return { error: "malformed signature", status: 400 };
  const sig = Buffer.from(signature, "base64");
  if (sig.length !== 64) return { error: "malformed signature", status: 400 };

  const fail = { error: "consent failed", status: 401 } as const;
  return mutate(deps, (s): ConsentResult => {
    const record = s.nonces[nonce];
    delete s.nonces[nonce]; // consumed on first attempt, valid or not
    if (!record || record.expires <= deps.now) return fail;
    if (record.action !== expected.action || record.terms !== expected.terms || record.authority !== expected.authority) return fail;
    if (record.domain !== domain || record.cluster !== deps.cluster) return fail;
    const message = consentMessage({ ...record, action: expected.action, terms: expected.terms, nonce });
    if (!verifyEd25519(new PublicKey(record.authority).toBytes(), Buffer.from(message, "utf8"), sig)) return fail;
    return { action: expected.action, terms: expected.terms, authority: record.authority, message, signature, at: new Date(deps.now).toISOString() };
  });
}

export async function getSession(deps: AuthDeps, token: string | null): Promise<Session | null> {
  if (!token) return null;
  const rec = (await readState(statePath(deps.dir))).sessions[sha256(token)];
  if (!rec || rec.expires <= deps.now || rec.cluster !== deps.cluster) return null;
  return { authority: rec.authority, cluster: rec.cluster, expiresAt: new Date(rec.expires).toISOString() };
}

export async function destroySession(deps: AuthDeps, token: string | null): Promise<void> {
  if (!token) return;
  await mutate(deps, (s) => { delete s.sessions[sha256(token)]; });
}

// ---------- request helpers (for the routes and for #305+) ----------

export function requestHost(request: Request): string {
  return request.headers.get("host") || new URL(request.url).host;
}

/** CSRF guard for mutating endpoints: Origin must be present and match the request host. Throws Response(403). */
export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  let ok = false;
  try {
    ok = !!origin && new URL(origin).host === requestHost(request);
  } catch {
    ok = false;
  }
  if (!ok) throw Response.json({ error: "origin not allowed" }, { status: 403 });
}

export function sessionToken(request: Request): string | null {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE) return rest.join("=") || null;
  }
  return null;
}

let clusterCache: Promise<string> | undefined;
async function genesisHash(): Promise<string> {
  clusterCache ??= new Connection(RPC_URL).getGenesisHash().catch((error) => {
    clusterCache = undefined;
    throw error;
  });
  return clusterCache;
}

export async function defaultDeps(): Promise<AuthDeps> {
  return { dir: defaultDir(), cluster: await genesisHash(), now: Date.now() };
}

/** The only way to learn "who is the authenticated authority": from the session cookie, never from a body. Throws Response(401). */
export async function requireSession(request: Request, deps?: AuthDeps): Promise<string> {
  const session = await getSession(deps ?? (await defaultDeps()), sessionToken(request));
  if (!session) throw Response.json({ error: "authentication required" }, { status: 401 });
  return session.authority;
}

export function sessionCookie(token: string, maxAgeSeconds = SESSION_TTL_MS / 1000): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}${secure}`;
}

/** Route wrapper: turns thrown Responses (401/403) into the response. */
export async function guarded(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    throw error;
  }
}

export async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const text = await request.text();
    if (text.length > 2048) return null;
    const body = JSON.parse(text);
    return typeof body === "object" && body !== null && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}
