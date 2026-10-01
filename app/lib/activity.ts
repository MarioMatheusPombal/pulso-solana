import { PublicKey } from "@solana/web3.js";
import type { ActivityEvent, ActivityEvidence, ActivityStatus } from "./store";

const STATUSES = new Set<ActivityStatus>(["autonomous", "blocked", "approved", "executed", "rejected"]);
const EVIDENCE = new Set<ActivityEvidence>(["confirmed_transaction", "simulation", "chain_account_observed"]);
const CODES = new Set([
  "PULSO_001_POLICY_NOT_FOUND", "PULSO_002_POLICY_DISABLED", "PULSO_003_HUMAN_INTENT_REQUIRED",
  "PULSO_004_INTENT_EXPIRED", "PULSO_005_INTENT_ALREADY_USED", "PULSO_006_INTENT_MISMATCH",
  "PULSO_007_RECIPIENT_NOT_ALLOWED", "PULSO_008_AMOUNT_EXCEEDS_LIMIT", "PULSO_009_DAILY_LIMIT_EXCEEDED",
  "PULSO_010_UNAUTHORIZED_AGENT", "PULSO_011_POLICY_CHANGE_FORBIDDEN",
]);
const HEX_32 = /^[0-9a-f]{64}$/i;
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SIGNATURE = /^[1-9A-HJ-NP-Za-km-z]{80,90}$/;
const AMOUNT_MAX = 18_446_744_073_709_551_615n;
const FIELDS = new Set([
  "eventId", "status", "evidence", "authority", "agent", "programId", "policy", "mint", "actionHash",
  "amount", "recipient", "code", "signature",
]);

export type ActivityInput = Omit<ActivityEvent, "createdAt">;

/** Accept only bounded, structured SDK reports. These reports are display data, never authority. */
export function parseActivity(body: unknown): { error: string } | { value: ActivityInput } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;
  if (Object.keys(b).some((key) => !FIELDS.has(key))) return { error: "body has unsupported fields" };
  if (typeof b.eventId !== "string" || !EVENT_ID.test(b.eventId)) return { error: "eventId must be a UUID" };
  if (typeof b.status !== "string" || !STATUSES.has(b.status as ActivityStatus)) return { error: "invalid activity status" };
  if (typeof b.evidence !== "string" || !EVIDENCE.has(b.evidence as ActivityEvidence)) return { error: "invalid activity evidence" };

  const keys: Record<string, PublicKey> = {};
  for (const field of ["authority", "agent", "programId", "policy", "recipient"] as const) {
    if (typeof b[field] !== "string") return { error: `${field} must be a public key` };
    try {
      keys[field] = new PublicKey(b[field]);
    } catch {
      return { error: `${field} must be a public key` };
    }
  }
  const expectedPolicy = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("policy"), keys.authority!.toBytes(), keys.agent!.toBytes()],
    keys.programId!,
  )[0];
  if (!expectedPolicy.equals(keys.policy!)) {
    return { error: "policy does not match authority, agent and programId" };
  }
  if (b.mint !== undefined) {
    if (typeof b.mint !== "string") return { error: "mint must be a public key" };
    try { keys.mint = new PublicKey(b.mint); } catch { return { error: "mint must be a public key" }; }
  }
  if (typeof b.amount !== "string" || !/^\d{1,20}$/.test(b.amount) || BigInt(b.amount) > AMOUNT_MAX) {
    return { error: "amount must be an unsigned token amount" };
  }
  if (b.actionHash !== undefined && (typeof b.actionHash !== "string" || !HEX_32.test(b.actionHash))) {
    return { error: "actionHash must be 32 bytes of hex" };
  }
  if (b.code !== undefined && (typeof b.code !== "string" || !CODES.has(b.code))) return { error: "unknown program error code" };
  if (b.signature !== undefined && (typeof b.signature !== "string" || !SIGNATURE.test(b.signature))) {
    return { error: "signature must be a base58 transaction signature" };
  }

  const status = b.status as ActivityStatus;
  const evidence = b.evidence as ActivityEvidence;
  const code = b.code as string | undefined;
  const signature = b.signature as string | undefined;
  const actionHash = b.actionHash as string | undefined;
  if ((status === "autonomous" || status === "executed") && (evidence !== "confirmed_transaction" || !signature || code)) {
    return { error: "confirmed activity requires a transaction signature" };
  }
  if (status === "executed" && !actionHash) return { error: "executed activity requires actionHash" };
  if ((status === "blocked" || status === "rejected") && (evidence !== "simulation" || !code || signature)) {
    return { error: "simulation activity requires a known program error code" };
  }
  if (status === "blocked" && code !== "PULSO_003_HUMAN_INTENT_REQUIRED" && code !== "PULSO_007_RECIPIENT_NOT_ALLOWED") {
    return { error: "blocked activity requires an approval error code" };
  }
  if (status === "rejected" && (code === "PULSO_003_HUMAN_INTENT_REQUIRED" || code === "PULSO_007_RECIPIENT_NOT_ALLOWED")) {
    return { error: "approval errors are blocked, not rejected" };
  }
  if (status === "approved" && (evidence !== "chain_account_observed" || !actionHash || code || signature)) {
    return { error: "approved activity requires an observed on-chain intent" };
  }

  return {
    value: {
      eventId: b.eventId,
      status,
      evidence,
      authority: keys.authority!.toBase58(),
      agent: keys.agent!.toBase58(),
      programId: keys.programId!.toBase58(),
      policy: keys.policy!.toBase58(),
      ...(keys.mint && { mint: keys.mint.toBase58() }),
      ...(actionHash && { actionHash: actionHash.toLowerCase() }),
      amount: b.amount,
      recipient: keys.recipient!.toBase58(),
      ...(code && { code }),
      ...(signature && { signature }),
    },
  };
}
