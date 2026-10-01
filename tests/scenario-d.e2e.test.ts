import { describe, expect, it } from "vitest";
import { runDemo } from "../agent-demo/src/demo.js";

describe("recipient tampering scenario D (issue 119)", () => {
  it("rejects the same approved transfer to another token account without state changes", async () => {
    const lines: string[] = [];
    const result = await runDemo({ scenario: "D", log: (line) => lines.push(line) });
    expect(result.scenarioD).toMatchObject({
      decision: "REJECTED",
      error: "PULSO_006_INTENT_MISMATCH",
      errorCode: 6005,
      signature: expect.any(String),
      confirmed: true,
      authorizedAmount: "100000000",
      attemptedAmount: "100000000",
      usedCountBefore: 0,
      usedCountAfter: 0,
    });
    expect(result.scenarioD.authorizedRecipient).not.toBe(result.scenarioD.attemptedRecipient);
    expect(result.scenarioD.authorizedMint).toBe(result.scenarioD.attemptedMint);
    expect(result.scenarioD.vaultAfter).toBe(result.scenarioD.vaultBefore);
    expect(result.scenarioD.authorizedRecipientAfter).toBe(result.scenarioD.authorizedRecipientBefore);
    expect(result.scenarioD.attemptedRecipientAfter).toBe(result.scenarioD.attemptedRecipientBefore);
    expect(lines.some((line) => line.includes("same amount and nonce"))).toBe(true);
    expect(lines.some((line) => line.includes("PULSO_006_INTENT_MISMATCH"))).toBe(true);
    expect(lines.some((line) => line.includes("rejected transaction confirmed"))).toBe(true);
  });
});
