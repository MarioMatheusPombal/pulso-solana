import { describe, expect, it } from "vitest";
import { deriveAuthority, spentNow, type PolicyLike } from "../lib/authority";

const U = 1_000_000n;
const p = (o: Partial<PolicyLike> = {}): PolicyLike => ({
  enabled: true,
  agentRevoked: false,
  requireApprovalAbove: 5n * U,
  maxPerTransaction: 20n * U,
  dailyLimit: 50n * U,
  requireApprovalForNewRecipient: true,
  spentInWindow: 12n * U,
  windowStart: 1000n,
  ...o,
});

describe("deriveAuthority", () => {
  it("fills the three blocks in human units", () => {
    const a = deriveAuthority(p(), 2000n);
    expect(a.state).toBe("active");
    expect(a.autonomous[0]).toBe("Up to 5.00 USDC per transaction");
    expect(a.autonomous[1]).toBe("Up to 50.00 USDC per day (12.00 USDC spent in the current window)");
    expect(a.humanApproval).toEqual(["Above 5.00 USDC up to 20.00 USDC per transaction", "Payments to a new recipient"]);
    expect(a.forbidden[0]).toBe("Anything above 20.00 USDC per transaction");
    expect(a.forbidden).toHaveLength(3);
  });
  it("omits the new recipient line when the flag is off", () => {
    expect(deriveAuthority(p({ requireApprovalForNewRecipient: false }), 2000n).humanApproval).toHaveLength(1);
  });
  it("reports paused and revoked (revoked wins)", () => {
    expect(deriveAuthority(p({ enabled: false }), 2000n).state).toBe("paused");
    expect(deriveAuthority(p({ enabled: false, agentRevoked: true }), 2000n).state).toBe("revoked");
  });
  it("counts an expired window as zero spent", () => {
    expect(spentNow(p(), 1000n + 86_399n)).toBe(12n * U);
    expect(spentNow(p(), 1000n + 86_400n)).toBe(0n);
  });
});
