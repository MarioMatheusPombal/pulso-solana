import { PublicKey } from "@solana/web3.js";
import { computeActionHash, INSTRUCTION_EXECUTE_TRANSFER } from "@pulso/sdk/src/intent.js";
import type { ApprovalRequest } from "./store";

const PUBKEY_FIELDS = ["programId", "policy", "authority", "agent", "mint", "recipient"] as const;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

export type NewRequest = Omit<ApprovalRequest, "status" | "createdAt" | "signature">;

/** Validates a POST body and recomputes the action hash. Returns an error message or the request. */
export function parseNewRequest(body: unknown): { error: string } | { value: NewRequest } {
  if (typeof body !== "object" || body === null) return { error: "body must be a JSON object" };
  const b = body as Record<string, unknown>;

  const keys: Record<string, PublicKey> = {};
  for (const f of PUBKEY_FIELDS) {
    const v = b[f];
    if (typeof v !== "string") return { error: `${f} must be a base58 string` };
    try {
      keys[f] = new PublicKey(v);
    } catch {
      return { error: `${f} is not a valid base58 public key` };
    }
  }

  const dec = (f: string) => {
    const v = b[f];
    return typeof v === "string" && /^-?\d+$/.test(v) ? BigInt(v) : null;
  };
  const amount = dec("amount");
  if (amount === null) return { error: "amount must be a decimal string" };
  const expiresAt = dec("expiresAt");
  if (expiresAt === null) return { error: "expiresAt must be a decimal string" };
  const maxUses = b.maxUses;
  if (typeof maxUses !== "number" || !Number.isInteger(maxUses)) {
    return { error: "maxUses must be an integer" };
  }
  const nonceHex = b.nonce;
  if (typeof nonceHex !== "string" || !/^[0-9a-fA-F]{32}$/.test(nonceHex)) {
    return { error: "nonce must be 16 bytes of hex (32 chars)" };
  }
  const claimed = b.actionHash;
  if (typeof claimed !== "string" || !/^[0-9a-fA-F]{64}$/.test(claimed)) {
    return { error: "actionHash must be 32 bytes of hex (64 chars)" };
  }

  let actionHash: string;
  try {
    actionHash = hex(
      computeActionHash({
        programId: keys.programId,
        instruction: INSTRUCTION_EXECUTE_TRANSFER,
        authority: keys.authority,
        agent: keys.agent,
        mint: keys.mint,
        amount,
        recipient: keys.recipient,
        maxUses,
        nonce: Buffer.from(nonceHex, "hex"),
        expiresAt,
      }),
    );
  } catch (e) {
    return { error: e instanceof Error ? e.message : "invalid fields" };
  }
  if (actionHash !== claimed.toLowerCase()) {
    return { error: "actionHash does not match the hash computed from the fields" };
  }

  return {
    value: {
      id: actionHash,
      programId: keys.programId.toBase58(),
      policy: keys.policy.toBase58(),
      authority: keys.authority.toBase58(),
      agent: keys.agent.toBase58(),
      mint: keys.mint.toBase58(),
      recipient: keys.recipient.toBase58(),
      amount: amount.toString(),
      expiresAt: expiresAt.toString(),
      maxUses,
      nonce: nonceHex.toLowerCase(),
      actionHash,
    },
  };
}
