import { describe, expect, it } from "vitest";
import { runDemo } from "../agent-demo/src/demo.js";

describe("receiver demands an authority receipt, scenario G (issue 284)", () => {
  it("delivers for autonomous and approved receipts; refuses a direct SPL transfer and replays", async () => {
    const lines: string[] = [];
    const { scenarioG: g } = await runDemo({ scenario: "G", log: (line) => lines.push(line) });

    expect(g.g1.status).toBe(200);
    expect(g.g1.receipt).toMatchObject({ mode: "autonomous", amount: "5000000" });
    expect(g.g1.receipt.hashVerified).toBeUndefined();

    expect(g.g2.status).toBe(200);
    expect(g.g2.receipt).toMatchObject({ mode: "approved", amount: "100000000", hashVerified: true });
    expect(g.g2.receipt.intent).toBeDefined();
    expect(g.g2.receipt.human).toBe(g.g1.receipt.human);

    expect(g.g3.status).toBe(402);
    expect(g.g3.refusal.reason).toBe("NOT_PULSO_TRANSFER");
    expect(BigInt(g.g3.receiverAfter) - BigInt(g.g3.receiverBefore)).toBe(5_000_000n);

    expect(g.g4.nonceMismatch.reason).toBe("NONCE_MISMATCH");
    expect(g.g4.consumed.reason).toBe("CHALLENGE_CONSUMED");

    expect(lines.some((line) => line.includes("receipt mode=autonomous"))).toBe(true);
    expect(lines.some((line) => line.includes("receipt mode=approved"))).toBe(true);
    expect(lines.some((line) => line.includes("hashVerified=true"))).toBe(true);
    expect(lines.some((line) => line.includes("payment arrived, delivery refused: no proof of authority"))).toBe(true);
    expect(lines.some((line) => line.includes("NOT AUDITED · DEVNET DEMONSTRATION ONLY"))).toBe(true);
  });
});
