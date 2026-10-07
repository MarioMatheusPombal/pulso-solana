import { describe, expect, it } from "vitest";
import { advanceClock, decideIntent, decisionFeedback, freshSimulation, makeTransfer, scenario } from "../lib/simulation";

const M = 1_000_000n;

describe("local simulation motor", () => {
  it("executes autonomous transfers and records their exact movement", () => {
    const state = makeTransfer(freshSimulation(), "Northstar Labs", 5n * M);
    expect(state.balance).toBe(245n * M);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].status).toBe("autonomous");
  });

  it("binds approval to a frozen exact payload and uses it once", () => {
    const pending = makeTransfer(freshSimulation(), "Northstar Labs", 25n * M);
    const intent = pending.queue[0];
    expect(Object.isFrozen(intent)).toBe(true);
    expect(intent).toMatchObject({ sender: "Aster Labs", agent: "Agent Atlas", recipient: "Northstar Labs", amount: 25n * M, mint: "USDC · simulated", policyVersion: 1, nonce: 1 });
    const approved = decideIntent(pending, intent.id, "approve");
    expect(approved.balance).toBe(225n * M);
    expect(approved.history[0].status).toBe("approved");
    const replay = decideIntent(approved, intent.id, "approve");
    expect(replay.balance).toBe(225n * M);
    expect(replay.history[0].status).toBe("approved");
    expect(replay.history[1].status).toBe("rejected");
  });

  it("rejects tampered payload, changed policy version, and expired intent", () => {
    const pending = makeTransfer(freshSimulation(), "Northstar Labs", 25n * M);
    const id = pending.queue[0].id;
    expect(decideIntent(pending, id, "approve", pending.clock, { amount: 26n * M }).history[0].status).toBe("rejected");
    const changedPolicy = { ...pending, policyVersion: 2 };
    expect(decideIntent(changedPolicy, id, "approve").history[0].status).toBe("rejected");
    expect(advanceClock(pending, 31).history[0].status).toBe("expired");
  });

  it("cannot approve past hard cap, daily spend, or available balance", () => {
    const base = freshSimulation();
    const pending = makeTransfer(base, "Northstar Labs", 25n * M);
    const cap = { ...pending, policy: { ...pending.policy, transactionCap: 20n * M } };
    expect(decideIntent(cap, cap.queue[0].id, "approve").history[0].status).toBe("blocked");
    const daily = { ...pending, spentInWindow: 190n * M, windowStartedAt: pending.clock };
    expect(decideIntent(daily, daily.queue[0].id, "approve").history[0].status).toBe("blocked");
    const balance = { ...pending, balance: 20n * M };
    expect(decideIntent(balance, balance.queue[0].id, "approve").history[0].status).toBe("blocked");
  });

  it("does not turn one-time approval into permanent recipient allowlisting", () => {
    const pending = makeTransfer(freshSimulation(), "One-time vendor", 5n * M, false);
    const after = decideIntent(pending, pending.queue[0].id, "approve");
    expect(after.knownRecipients).not.toContain("One-time vendor");
    expect(makeTransfer(after, "One-time vendor", 5n * M, false).history.at(-1)?.status).toBe("pending");
  });

  it("rejects self-transfers and bounds history with its pending intents", () => {
    expect(makeTransfer(freshSimulation(), "Aster Labs", M, true).history[0].detail).toMatch(/different companies/);
    const roomy = freshSimulation({ transactionCap: 20n * M, dailyLimit: 10_000n * M });
    let state = roomy;
    for (let index = 0; index < 510; index++) state = makeTransfer(state, "Northstar Labs", 11n * M);
    expect(state.history).toHaveLength(500);
    expect(state.queue).toHaveLength(500);
    expect(state.queue.every((intent) => state.history.some((row) => row.id === intent.transferId))).toBe(true);
  });

  it("runs each attack scenario with its own deterministic baseline", () => {
    for (const key of ["C", "D", "E", "F"] as const) {
      const result = scenario(freshSimulation({ autonomousLimit: 200n * M }), key);
      expect(result.history.at(-1)?.status).toBe(key === "E" ? "rejected" : key === "F" ? "expired" : "rejected");
      expect(result.balance).toBe(key === "E" ? 225n * M : 250n * M);
    }
    expect(scenario(freshSimulation(), "A").history[0].status).toBe("autonomous");
    expect(scenario(freshSimulation(), "B").history[0].status).toBe("pending");
  });

  it("reports the real outcome of a human decision, not a fixed success message", () => {
    const pending = makeTransfer(freshSimulation(), "Northstar Labs", 25n * M);
    const intent = pending.queue[0];
    expect(decisionFeedback(decideIntent(pending, intent.id, "approve"), intent.transferId)).toEqual({ message: "Exact payload approved and simulated.", blocked: false });
    const changedPolicy = { ...pending, policyVersion: pending.policyVersion + 1 };
    const rejected = decisionFeedback(decideIntent(changedPolicy, intent.id, "approve"), intent.transferId);
    expect(rejected.blocked).toBe(true);
    expect(rejected.message).toMatch(/Policy version changed/);
    const late = decisionFeedback(decideIntent(pending, intent.id, "approve", intent.expiresAt + 1), intent.transferId);
    expect(late.message).toMatch(/expired/);
    expect(decisionFeedback(decideIntent(pending, intent.id, "deny"), intent.transferId).message).toMatch(/denied/);
  });
});
