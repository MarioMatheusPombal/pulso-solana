import { describe, expect, it } from "vitest";
import { runDemo } from "../src/demo.js";
import { usdc } from "../src/setup.js";

describe("demo, scenarios A and B (issue 110)", () => {
  it("A executes alone; B pauses, is approved by the human, and executes", async () => {
    const lines: string[] = [];
    const r = await runDemo({ approve: "auto", log: (l) => lines.push(l) });

    expect(r.scenarioA.steps.map((s) => [s.decision, s.approved])).toEqual([["EXECUTED", undefined]]);
    expect(r.scenarioB.steps.map((s) => [s.decision, s.approved])).toEqual([["EXECUTED", true]]);
    expect(r.vaultDelta).toBe(usdc(105));
    expect(r.merchantDelta).toBe(usdc(105));
    expect(lines.some((l) => l.includes("HUMAN_INTENT_REQUIRED"))).toBe(true);
    expect(lines.some((l) => l.includes("simulated human approval"))).toBe(true);
    expect(lines.some((l) => l.includes("summary: 1 autonomous, 1 approved (1/1 hash verified), 0 refused"))).toBe(true);
  });
});
