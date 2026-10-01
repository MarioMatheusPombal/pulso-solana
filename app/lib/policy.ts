import { PublicKey } from "@solana/web3.js";
import { parseUnits } from "./units";

export interface PolicyForm {
  agent: string;
  autonomous: string;
  cap: string;
  daily: string;
  requireNewRecipient: boolean;
  mint: string;
}

export interface PolicyArgs {
  agent: PublicKey;
  mint: PublicKey;
  requireApprovalAbove: bigint;
  maxPerTransaction: bigint;
  dailyLimit: bigint;
  requireApprovalForNewRecipient: boolean;
}

function key(label: string, v: string): { value: PublicKey } | { error: string } {
  try {
    return { value: new PublicKey(v.trim()) };
  } catch {
    return { error: `${label} is not a valid public key.` };
  }
}

/** Mirrors the on-chain rule: autonomous <= per-transaction cap <= daily limit. */
export function validatePolicyForm(f: PolicyForm): { error: string } | { value: PolicyArgs } {
  const agent = key("Agent", f.agent);
  if ("error" in agent) return agent;
  const mint = key("Mint", f.mint);
  if ("error" in mint) return mint;
  const nums: Record<string, bigint> = {};
  for (const [name, label, raw] of [
    ["autonomous", "Autonomous limit", f.autonomous],
    ["cap", "Per-transaction cap", f.cap],
    ["daily", "Daily limit", f.daily],
  ] as const) {
    const r = parseUnits(raw);
    if ("error" in r) return { error: `${label}: ${r.error}` };
    nums[name] = r.value;
  }
  if (nums.autonomous > nums.cap) return { error: "Rule violated: autonomous limit must be at most the per-transaction cap." };
  if (nums.cap > nums.daily) return { error: "Rule violated: per-transaction cap must be at most the daily limit." };
  return {
    value: {
      agent: agent.value,
      mint: mint.value,
      requireApprovalAbove: nums.autonomous,
      maxPerTransaction: nums.cap,
      dailyLimit: nums.daily,
      requireApprovalForNewRecipient: f.requireNewRecipient,
    },
  };
}
