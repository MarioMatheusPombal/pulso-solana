import { computeTermsDigest, findPolicyPda, type B2BTerms } from "@pulso/sdk";
import { PublicKey } from "@solana/web3.js";
import { createPublicKey, verify as edVerify } from "node:crypto";

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Offline validation of a `pulso-b2b-package-v1` (solana/14_B2B_NETWORK_SPEC.md, section 7).
// The agent does not trust the backend: it recomputes the digest, re-reads the consent envelope and
// verifies Ed25519 itself. `status` and `ready` in the package are hints and are never read here.
// The `expires:` line of a consent is not rechecked: it bounded the server's acceptance window.

export const PACKAGE_VERSION = "pulso-b2b-package-v1";

export type RefusalCode =
  | "BAD_PACKAGE"
  | "UNKNOWN_VERSION"
  | "AMOUNT_INVALID"
  | "DIGEST_MISMATCH"
  | "REQUEST_ID_MISMATCH"
  | "RECEIVER_CONSENT_REQUIRED"
  | "CONSENT_MISSING"
  | "CONSENT_BAD_ENVELOPE"
  | "CONSENT_ACTION_MISMATCH"
  | "CONSENT_SIGNER_MISMATCH"
  | "CONSENT_AUTHORITY_MISMATCH"
  | "CONSENT_CLUSTER_MISMATCH"
  | "CONSENT_TERMS_MISMATCH"
  | "CONSENT_BAD_SIGNATURE"
  | "AGENT_MISMATCH"
  | "POLICY_MISMATCH"
  | "PROGRAM_MISMATCH"
  | "GENESIS_MISMATCH"
  | "EXPIRED";

export interface Validated {
  requestId: string;
  kind: "charge" | "send";
  digest: string;
  terms: B2BTerms;
}

export type Validation = { ok: true; value: Validated } | { ok: false; code: RefusalCode; detail: string };

export interface ValidationContext {
  /** The local agent key: the package must name it. */
  agent: PublicKey;
  /** Program the SDK talks to. */
  programId: PublicKey;
  /** Genesis hash (base58) reported by the RPC in use. */
  genesis: string;
  /** Unix seconds. */
  nowSeconds: number;
}

const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;
const SPKI_ED25519 = Buffer.from("302a300506032b6570032100", "hex");
const CONSENT_TITLE = "PULSO network consent";
const CONSENT_SECOND = "NOT A TRANSACTION · grants no spending authority";
const ENVELOPE_KEYS = ["domain", "action", "authority", "cluster", "terms", "nonce", "issued", "expires"] as const;

class Refuse extends Error {
  constructor(
    readonly code: RefusalCode,
    readonly detail: string,
  ) {
    super(`${code}: ${detail}`);
  }
}
const refuse = (code: RefusalCode, detail: string): never => {
  throw new Refuse(code, detail);
};

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function pubkey(v: unknown, what: string): PublicKey {
  if (typeof v === "string" && v.length >= 32 && v.length <= 44) {
    try {
      const k = new PublicKey(v);
      if (k.toBase58() === v) return k;
    } catch {
      // falls through
    }
  }
  return refuse("BAD_PACKAGE", `${what} is not a base58 public key`);
}

function str(v: unknown, what: string, re: RegExp): string {
  if (typeof v !== "string" || !re.test(v)) refuse("BAD_PACKAGE", `${what} is malformed`);
  return v as string;
}

function verifyEd25519(pubkeyBytes: Uint8Array, message: Uint8Array, signature: Uint8Array): boolean {
  try {
    const key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, pubkeyBytes]), format: "der", type: "spki" });
    return edVerify(null, message, key, signature);
  } catch {
    return false;
  }
}

/** The ten lines of the spec envelope, each once and in order; returns the values by key. */
function parseEnvelope(message: string): Record<(typeof ENVELOPE_KEYS)[number], string> {
  const lines = message.split("\n");
  if (lines.length !== 2 + ENVELOPE_KEYS.length || lines[0] !== CONSENT_TITLE || lines[1] !== CONSENT_SECOND) {
    refuse("CONSENT_BAD_ENVELOPE", "message is not the 10-line consent envelope");
  }
  const out: Record<string, string> = {};
  ENVELOPE_KEYS.forEach((key, i) => {
    const prefix = `${key}: `;
    const line = lines[i + 2]!;
    if (!line.startsWith(prefix) || line.length === prefix.length) refuse("CONSENT_BAD_ENVELOPE", `line ${i + 3} must be "${key}: <value>"`);
    out[key] = line.slice(prefix.length);
  });
  return out as Record<(typeof ENVELOPE_KEYS)[number], string>;
}

function checkConsent(entry: unknown, want: { action: string; signer: PublicKey; cluster: string; digest: string }): void {
  if (!isObject(entry)) return refuse("BAD_PACKAGE", "consent entry is not an object");
  const { message, signature } = entry;
  if (typeof message !== "string") return refuse("BAD_PACKAGE", "consent.message is not a string");
  const sig = typeof signature === "string" ? Buffer.from(signature, "base64") : Buffer.alloc(0);
  if (sig.length !== 64) return refuse("BAD_PACKAGE", "consent.signature is not 64 bytes of base64");
  const signer = pubkey(entry.signer, "consent.signer");
  const env = parseEnvelope(message);
  if (entry.action !== want.action || env.action !== want.action) refuse("CONSENT_ACTION_MISMATCH", `expected ${want.action}`);
  if (!signer.equals(want.signer)) refuse("CONSENT_SIGNER_MISMATCH", `${want.action} must be signed by ${want.signer.toBase58()}`);
  if (env.authority !== signer.toBase58()) refuse("CONSENT_AUTHORITY_MISMATCH", "authority in the message is not the signer");
  if (env.cluster !== want.cluster) refuse("CONSENT_CLUSTER_MISMATCH", "cluster in the message is not the snapshot genesis");
  if (env.terms !== want.digest) refuse("CONSENT_TERMS_MISMATCH", "terms in the message are not the digest");
  if (!verifyEd25519(signer.toBytes(), Buffer.from(message, "utf8"), sig)) refuse("CONSENT_BAD_SIGNATURE", `${want.action} signature does not verify`);
}

/** Pure: no I/O, no clock. Anything other than `ok: true` means the agent must not execute. */
export function validatePackage(pkg: unknown, ctx: ValidationContext): Validation {
  try {
    return { ok: true, value: validate(pkg, ctx) };
  } catch (e) {
    if (e instanceof Refuse) return { ok: false, code: e.code, detail: e.detail };
    throw e;
  }
}

function validate(pkg: unknown, ctx: ValidationContext): Validated {
  if (!isObject(pkg)) return refuse("BAD_PACKAGE", "package is not a JSON object");
  if (pkg.version !== PACKAGE_VERSION) refuse("UNKNOWN_VERSION", `expected ${PACKAGE_VERSION}`);
  const kind = pkg.kind;
  if (kind !== "charge" && kind !== "send") return refuse("BAD_PACKAGE", "kind must be charge or send");
  const s = pkg.snapshot;
  if (!isObject(s)) return refuse("BAD_PACKAGE", "snapshot is missing");
  if (s.kind !== kind) refuse("BAD_PACKAGE", "snapshot.kind differs from kind");

  const requestId = str(pkg.requestId, "requestId", /^[0-9a-f]{32}$/);
  const digest = str(pkg.digest, "digest", /^[0-9a-f]{64}$/);
  const nonce = str(s.nonce, "snapshot.nonce", /^[0-9a-f]{32}$/);
  const amountText = str(s.amount, "snapshot.amount", /^(0|[1-9][0-9]{0,19})$/);
  const expiryText = str(s.expiry, "snapshot.expiry", /^(0|[1-9][0-9]{0,18})$/);
  const genesis = pubkey(s.genesis, "snapshot.genesis");
  const terms: B2BTerms = {
    kind,
    genesis: genesis.toBytes(),
    programId: pubkey(s.programId, "snapshot.programId"),
    policy: pubkey(s.policy, "snapshot.policy"),
    payerAuthority: pubkey(s.payerAuthority, "snapshot.payerAuthority"),
    agent: pubkey(s.agent, "snapshot.agent"),
    mint: pubkey(s.mint, "snapshot.mint"),
    recipientTokenAccount: pubkey(s.recipientTokenAccount, "snapshot.recipientTokenAccount"),
    receiverAuthority: pubkey(s.receiverAuthority, "snapshot.receiverAuthority"),
    amount: BigInt(amountText),
    nonce: Buffer.from(nonce, "hex"),
    expiry: BigInt(expiryText),
  };
  if (terms.amount <= 0n || terms.amount > U64_MAX) refuse("AMOUNT_INVALID", "amount must satisfy 0 < amount < 2^64");
  if (terms.expiry > I64_MAX) refuse("BAD_PACKAGE", "expiry out of range");

  if (Buffer.from(computeTermsDigest(terms)).toString("hex") !== digest) refuse("DIGEST_MISMATCH", "digest does not match the snapshot");
  if (requestId !== nonce) refuse("REQUEST_ID_MISMATCH", "requestId is not the snapshot nonce");

  // The receiver's consent is mandatory in both forms; the payer's proposal consent only for `send`.
  if (!Array.isArray(pkg.consent)) return refuse("BAD_PACKAGE", "consent is not a list");
  const consent: unknown[] = pkg.consent;
  const byAction = (action: string) => consent.find((c) => isObject(c) && c.action === action);
  const receiverAction = kind === "charge" ? "network.charge.issue" : "network.send.accept";
  const receiverEntry = byAction(receiverAction);
  if (!receiverEntry) refuse("RECEIVER_CONSENT_REQUIRED", `missing ${receiverAction} from the receiver`);
  const want = { cluster: genesis.toBase58(), digest };
  if (kind === "send") {
    const propose = byAction("network.send.propose");
    if (!propose) refuse("CONSENT_MISSING", "missing network.send.propose from the payer");
    checkConsent(propose, { ...want, action: "network.send.propose", signer: terms.payerAuthority });
  }
  checkConsent(receiverEntry, { ...want, action: receiverAction, signer: terms.receiverAuthority });

  if (!terms.agent.equals(ctx.agent)) refuse("AGENT_MISMATCH", "snapshot.agent is not this agent");
  if (!terms.policy.equals(findPolicyPda(terms.payerAuthority, terms.agent, terms.programId))) refuse("POLICY_MISMATCH", "snapshot.policy is not the PDA of (payerAuthority, agent)");
  if (!terms.programId.equals(ctx.programId)) refuse("PROGRAM_MISMATCH", "snapshot.programId is not the SDK program");
  if (genesis.toBase58() !== ctx.genesis) refuse("GENESIS_MISMATCH", "snapshot.genesis is not the genesis hash of the RPC");
  if (terms.expiry <= BigInt(ctx.nowSeconds)) refuse("EXPIRED", "snapshot.expiry is in the past");
  return { requestId, kind, digest, terms };
}
