import { describe, expect, it } from "vitest";
import { runDemo } from "../agent-demo/src/demo.js";

describe("single-use authorization replay scenario E (issue 120)", () => {
  it("confirms one concurrent execution and rejects concurrent and sequential replays", async () => {
    const lines: string[] = [];
    const result = await runDemo({ scenario: "E", log: (line) => lines.push(line) });
    const scenario = result.scenarioE;
    expect(scenario.decision).toBe("EXECUTED_ONCE_REPLAY_REJECTED");
    expect(new Set(scenario.concurrentSignatures).size).toBe(2);
    expect(scenario.concurrentSuccessSignature).not.toBe(scenario.concurrentReplaySignature);
    expect(scenario.sequentialReplaySignature).not.toBe(scenario.concurrentSuccessSignature);
    expect(scenario.sequentialReplaySignature).not.toBe(scenario.concurrentReplaySignature);
    expect(scenario.errorCode).toBe(6004);
    expect(BigInt(scenario.vaultBefore) - BigInt(scenario.vaultAfter)).toBe(100_000_000n);
    expect(BigInt(scenario.recipientAfter) - BigInt(scenario.recipientBefore)).toBe(100_000_000n);
    expect(scenario.usedCountBefore).toBe(0);
    expect(scenario.usedCountAfter).toBe(1);
    expect(BigInt(scenario.spentAfter) - BigInt(scenario.spentBefore)).toBe(100_000_000n);
    expect(lines.some((line) => line.includes("concurrent replay confirmed PULSO_005_INTENT_ALREADY_USED (6004)"))).toBe(true);
    expect(lines.some((line) => line.includes("sequential replay confirmed PULSO_005_INTENT_ALREADY_USED (6004)"))).toBe(true);
  });
});
