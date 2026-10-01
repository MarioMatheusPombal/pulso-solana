import { PublicKey } from "@solana/web3.js";
import { computeActionHash, INSTRUCTION_EXECUTE_TRANSFER } from "@pulso/sdk/src/intent.js";
import { findPolicyPda } from "@pulso/sdk/src/pda.js";
import { formatUnits } from "./units";

/** Request as served by GET /api/approvals/[id] (only the fields that matter here). */
export interface ApprovalPayload {
  programId: string;
  policy: string;
  authority: string;
  agent: string;
  mint: string;
  recipient: string;
  amount: string;
  expiresAt: string;
  maxUses: number;
  nonce: string;
  actionHash: string;
}

/** What the screen shows. Derived from the same parsed fields that feed the hash. */
export interface ApprovalDisplay {
  action: string;
  amount: string;
  mint: string;
  recipient: string;
  agent: string;
  authority: string;
  expiresAt: bigint;
  maxUses: number;
  nonce: string;
  actionHash: string;
}

/** Exact arguments of record_intent(action_hash, expires_at, max_uses). */
export interface RecordIntentArgs {
  actionHash: Uint8Array;
  expiresAt: bigint;
  maxUses: number;
}

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

/**
 * Single path from the displayed fields to the hash to the instruction arguments.
 * Recomputes the action hash from the fields and refuses (ok: false) when it differs from the one in the request,
 * so the screen can never show something other than what gets signed.
 */
export function prepareApproval(
  p: ApprovalPayload,
): { ok: true; display: ApprovalDisplay; args: RecordIntentArgs } | { ok: false; error: string } {
  try {
    if (!/^[0-9a-fA-F]{32}$/.test(p.nonce)) throw new Error("nonce is not 16 bytes of hex");
    if (!/^\d+$/.test(p.amount) || !/^-?\d+$/.test(p.expiresAt)) throw new Error("amount or expiresAt is not a decimal string");
    const programId = new PublicKey(p.programId);
    const authority = new PublicKey(p.authority);
    const agent = new PublicKey(p.agent);
    const mint = new PublicKey(p.mint);
    const recipient = new PublicKey(p.recipient);
    const amount = BigInt(p.amount);
    const expiresAt = BigInt(p.expiresAt);
    const hash = computeActionHash({
      programId,
      instruction: INSTRUCTION_EXECUTE_TRANSFER,
      authority,
      agent,
      mint,
      amount,
      recipient,
      maxUses: p.maxUses,
      nonce: Buffer.from(p.nonce, "hex"),
      expiresAt,
    });
    const computed = hex(hash);
    if (computed !== p.actionHash.toLowerCase()) {
      return { ok: false, error: "The hash computed from the displayed fields does not match the request's action hash. Do not approve." };
    }
    // The policy account is not part of the hash; it must still be the PDA of (authority, agent).
    if (!findPolicyPda(authority, agent, programId).equals(new PublicKey(p.policy))) {
      return { ok: false, error: "The policy in the request is not the policy of this authority and agent. Do not approve." };
    }
    return {
      ok: true,
      display: {
        action: "SPL token transfer",
        amount: `${formatUnits(amount)} USDC`,
        mint: mint.toBase58(),
        recipient: recipient.toBase58(),
        agent: agent.toBase58(),
        authority: authority.toBase58(),
        expiresAt,
        maxUses: p.maxUses,
        nonce: p.nonce.toLowerCase(),
        actionHash: computed,
      },
      args: { actionHash: hash, expiresAt, maxUses: p.maxUses },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "invalid request" };
  }
}

/** Seconds left until expiry (negative once expired). */
export function secondsLeft(expiresAt: bigint, nowMs: number): number {
  return Number(expiresAt - BigInt(Math.floor(nowMs / 1000)));
}

export function formatCountdown(s: number): string {
  if (s <= 0) return "expired";
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${s}s`;
}
