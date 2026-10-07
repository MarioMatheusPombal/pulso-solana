import { describe, expect, it } from "vitest";
import { answerConnection, answerTerms, emptyBusinessFlow, inviteConnection, proposeTerms, submitBusinessPayment } from "../lib/simulation-business";
import { freshSimulation, makeTransfer } from "../lib/simulation";

describe("simulated company agreement flow", () => {
  it("requires an accepted connection and exact accepted terms before a single payment submission", () => {
    const draft = emptyBusinessFlow();
    expect(proposeTerms(draft, { id: 1, sender: "Aster Labs", recipient: "Northstar Labs", amount: 24_000_000n, direction: "charge" }).error).toMatch(/Connect/);
    const invited = inviteConnection(draft);
    const connected = answerConnection(invited, true);
    const proposal = proposeTerms(connected, { id: 1, sender: "Aster Labs", recipient: "Northstar Labs", amount: 24_000_000n, direction: "charge" }).state;
    const accepted = answerTerms(proposal, true);
    const submitted = submitBusinessPayment(accepted);
    expect(submitted.payment).toMatchObject({ amount: 24_000_000n, recipient: "Northstar Labs", accepted: true });
    const policyRequest = makeTransfer(freshSimulation(), submitted.payment!.recipient, submitted.payment!.amount);
    expect(policyRequest.history[0].status).toBe("pending");
    expect(policyRequest.balance).toBe(250_000_000n);
    expect(submitBusinessPayment(submitted.state).error).toMatch(/already submitted/);
  });

  it("submits the frozen terms snapshot even if the editor changes later", () => {
    const connection = answerConnection(inviteConnection(emptyBusinessFlow()), true);
    const proposal = proposeTerms(connection, { id: 1, sender: "Aster Labs", recipient: "Northstar Labs", amount: 24_000_000n, direction: "send" }).state;
    const accepted = answerTerms(proposal, true);
    expect(Object.isFrozen(accepted.terms)).toBe(true);
    expect(Reflect.set(accepted.terms!, "amount", 80_000_000n)).toBe(false);
    // The component keeps the editor separate; accepted state retains its original terms.
    expect(submitBusinessPayment(accepted).payment?.amount).toBe(24_000_000n);
  });

  it("requires the counterparty to accept terms; a decline cannot submit", () => {
    const connection = answerConnection(inviteConnection(emptyBusinessFlow()), true);
    const proposal = proposeTerms(connection, { id: 1, sender: "Aster Labs", recipient: "Northstar Labs", amount: 24_000_000n, direction: "send" }).state;
    const declined = answerTerms(proposal, false);
    expect(submitBusinessPayment(declined).error).toMatch(/accept the exact terms/);
  });
});
