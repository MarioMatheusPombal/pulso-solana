import { Keypair } from "@solana/web3.js";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { createPulsoTransferGate, type PulsoGateResult } from "../src/gate.js";
import { PulsoClient, type PendingApproval } from "../src/client.js";
import { ApprovalDeniedError, ApprovalTimeoutError } from "../src/errors.js";
import { buildIntent } from "../src/intent.js";
import { PROGRAM_ID } from "../src/program.js";

const human = Keypair.generate().publicKey;
const agent = Keypair.generate();
const mint = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const intent = buildIntent({
  programId: PROGRAM_ID,
  authority: human,
  agent: agent.publicKey,
  mint,
  amount: 15_000_000n,
  recipient,
  expiresAt: 2_000_000_000n,
});
const pending: PendingApproval = {
  status: "HUMAN_INTENT_REQUIRED",
  reason: "HUMAN_INTENT_REQUIRED",
  intent,
  approvalId: Buffer.from(intent.actionHash).toString("hex"),
  approvalUrl: "https://pulso.test/approvals/example",
};

function fakeClient(overrides: Partial<PulsoClient>) {
  return {
    execute: vi.fn(async () => ({ status: "executed" as const, signature: "sig" })),
    waitForApproval: vi.fn(async () => {}),
    executeApproved: vi.fn(async () => ({ status: "executed" as const, signature: "approved-sig" })),
    ...overrides,
  } as unknown as PulsoClient;
}

describe("createPulsoTransferGate", () => {
  it("normalizes framework strings and returns on-chain execution", async () => {
    const client = fakeClient({ execute: vi.fn(async (p) => {
      expect(p).toEqual({ amount: 15_000_000n, recipient });
      return { status: "executed" as const, signature: "sig" };
    }) });
    const result = await createPulsoTransferGate(client)({ amount: "15000000", recipient: recipient.toBase58() });
    expect(result).toEqual({ status: "executed", signature: "sig" });
  });

  it("returns exact pending intent for human approval without executing it", async () => {
    const client = fakeClient({ execute: vi.fn(async () => pending) });
    const result = await createPulsoTransferGate(client)({ amount: "15000000", recipient: recipient.toBase58() });
    expect(result).toMatchObject({
      status: "human_intent_required",
      reason: "HUMAN_INTENT_REQUIRED",
      approvalId: pending.approvalId,
      intent: {
        amount: "15000000",
        recipient: recipient.toBase58(),
        actionHash: pending.approvalId,
      },
    });
    expect(client.waitForApproval).not.toHaveBeenCalled();
    expect(client.executeApproved).not.toHaveBeenCalled();
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  it("waits for approval and executes only the stored intent when configured", async () => {
    const client = fakeClient({ execute: vi.fn(async () => pending) });
    const result = await createPulsoTransferGate(client, { waitForApproval: true })({
      amount: "15000000",
      recipient: recipient.toBase58(),
    });
    expect(result).toEqual({ status: "executed", signature: "approved-sig" });
    expect(client.waitForApproval).toHaveBeenCalledWith(pending, undefined);
    expect(client.executeApproved).toHaveBeenCalledWith(pending);
  });

  it("propagates SDK errors and rejects malformed tool input before execution", async () => {
    const error = new Error("chain unavailable");
    const client = fakeClient({ execute: vi.fn(async () => { throw error; }) });
    await expect(createPulsoTransferGate(client)({ amount: "1", recipient: recipient.toBase58() })).rejects.toBe(error);
    await expect(createPulsoTransferGate(client)({ amount: "1e3", recipient: recipient.toBase58() })).rejects.toThrow(/decimal string/);
    await expect(createPulsoTransferGate(client)({ amount: "1", recipient: "invalid" })).rejects.toThrow();
    await expect(createPulsoTransferGate(client)({ amount: 1000 as unknown as string, recipient: recipient.toBase58() })).rejects.toThrow(/decimal string/);
    expect(client.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["denial", new ApprovalDeniedError(pending.approvalId)],
    ["timeout", new ApprovalTimeoutError(pending.approvalId, 1000)],
  ])("does not execute approved intent after %s", async (_case, error) => {
    const client = fakeClient({
      execute: vi.fn(async () => pending),
      waitForApproval: vi.fn(async () => { throw error; }),
    });
    await expect(createPulsoTransferGate(client, { waitForApproval: true })({
      amount: "15000000",
      recipient: recipient.toBase58(),
    })).rejects.toBe(error);
    expect(client.executeApproved).not.toHaveBeenCalled();
  });

  it("exposes a framework-serializable result union", () => {
    expectTypeOf<Awaited<ReturnType<ReturnType<typeof createPulsoTransferGate>>>>().toEqualTypeOf<PulsoGateResult>();
  });
});
