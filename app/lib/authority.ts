import { formatUnits } from "./units";

/** The fields of AgentPolicy that decide authority, in base units (plain values, easy to test). */
export interface PolicyLike {
  enabled: boolean;
  agentRevoked: boolean;
  maxPerTransaction: bigint;
  dailyLimit: bigint;
  requireApprovalForNewRecipient: boolean;
  requireApprovalAbove: bigint;
  spentInWindow: bigint;
  windowStart: bigint;
}

export const WINDOW_SECONDS = 86_400n;

export interface Authority {
  state: "active" | "paused" | "revoked";
  autonomous: string[];
  humanApproval: string[];
  forbidden: string[];
}

const usdc = (v: bigint) => `${formatUnits(v)} USDC`;

/** Spent amount in the current fixed 24h window; the program resets it lazily, so an expired window counts as 0. */
export function spentNow(p: PolicyLike, nowSeconds: bigint): bigint {
  return nowSeconds >= p.windowStart + WINDOW_SECONDS ? 0n : p.spentInWindow;
}

/** Derives the three authority blocks from the on-chain rules. */
export function deriveAuthority(p: PolicyLike, nowSeconds: bigint): Authority {
  const spent = spentNow(p, nowSeconds);
  const humanApproval = [`Above ${usdc(p.requireApprovalAbove)} up to ${usdc(p.maxPerTransaction)} per transaction`];
  if (p.requireApprovalForNewRecipient) humanApproval.push("Payments to a new recipient");
  return {
    state: p.agentRevoked ? "revoked" : p.enabled ? "active" : "paused",
    autonomous: [
      `Up to ${usdc(p.requireApprovalAbove)} per transaction`,
      `Up to ${usdc(p.dailyLimit)} per day (${usdc(spent)} spent in the current window)`,
    ],
    humanApproval,
    forbidden: [
      `Anything above ${usdc(p.maxPerTransaction)} per transaction`,
      "Changing its own policy",
      "Approving its own recipients or intents",
    ],
  };
}
