import { describe, expect, it } from "vitest";
import { runDemo } from "../agent-demo/src/demo.js";

describe("amount tampering scenario C (issue 118)", () => {
  it("rejects 150 USDC against the human-approved 100 USDC intent without state changes", async () => {
    const lines: string[] = [];
    const result = await runDemo({ scenario: "C", log: (line) => lines.push(line) });
    expect(result.scenarioC).toMatchObject({
      decision: "REJECTED",
      error: "PULSO_006_INTENT_MISMATCH",
      errorCode: 6005,
      signature: expect.any(String),
      confirmed: true,
      authorizedAmount: "100000000",
      attemptedAmount: "150000000",
      usedCountBefore: 0,
      usedCountAfter: 0,
    });
    expect(result.scenarioC.vaultAfter).toBe(result.scenarioC.vaultBefore);
    expect(result.scenarioC.recipientAfter).toBe(result.scenarioC.recipientBefore);
    expect(lines.some((line) => line.includes("same intent hash and nonce"))).toBe(true);
    expect(lines.some((line) => line.includes("PULSO_006_INTENT_MISMATCH"))).toBe(true);
    expect(lines.some((line) => line.includes("rejected transaction confirmed"))).toBe(true);
  });
});
