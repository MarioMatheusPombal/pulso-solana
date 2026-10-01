import { describe, expect, it } from "vitest";
import { runDemo } from "../agent-demo/src/demo.js";

describe("expired authorization scenario F (issue 121)", () => {
  it("runs the focal LiteSVM clock test and reports the unchanged post-expiry state", async () => {
    const lines: string[] = [];
    const result = await runDemo({ scenario: "F", log: (line) => lines.push(line) });
    expect(result.scenarioF).toMatchObject({
      runtime: "LiteSVM",
      errorCode: 6003,
      vault: 9_300n,
      recipient: 700n,
      spent: 700n,
      usedCount: 1,
    });
    expect(result.scenarioF.clock).toBe(result.scenarioF.expiresAt + 1);
    expect(lines.some((line) => line.includes("simulated on-chain result PULSO_004_INTENT_EXPIRED (6003)"))).toBe(true);
    expect(lines.some((line) => line.includes("LiteSVM Clock advanced"))).toBe(true);
    expect(lines.some((line) => line.includes("transaction"))).toBe(false);
  });
});
