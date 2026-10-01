import { Keypair, PublicKey, type Connection } from "@solana/web3.js";
import { describe, expect, expectTypeOf, it } from "vitest";
import { PulsoClient, type PendingApproval } from "../src/client.js";
import { ApprovalDeniedError, ApprovalTimeoutError } from "../src/errors.js";
import { buildIntent } from "../src/intent.js";
import { PROGRAM_ID } from "../src/program.js";

const human = Keypair.generate().publicKey;
const agent = Keypair.generate();
const k = () => Keypair.generate().publicKey;

const intent = buildIntent({
  programId: PROGRAM_ID, authority: human, agent: agent.publicKey, mint: k(), amount: 5n, recipient: k(), expiresAt: 2_000_000_000n,
});
const pending: PendingApproval = {
  status: "HUMAN_INTENT_REQUIRED",
  reason: "HUMAN_INTENT_REQUIRED",
  intent,
  approvalId: Buffer.from(intent.actionHash).toString("hex"),
  approvalUrl: undefined,
};

// Fake clock: sleeping advances time, nothing really waits.
function harness(o: { intentAppearsAfterPolls?: number; backend?: () => string | Error } = {}) {
  let t = 0;
  const delays: number[] = [];
  let polls = 0;
  const connection = {
    getAccountInfo: async () => (++polls > (o.intentAppearsAfterPolls ?? Infinity) ? { data: Buffer.alloc(0) } : null),
  } as unknown as Connection;
  const fakeFetch = (async () => {
    const r = o.backend!();
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify({ status: r }));
  }) as unknown as typeof fetch;
  const client = new PulsoClient({
    connection, agent, human, fetch: fakeFetch, approvalsUrl: o.backend ? "http://app.test" : undefined,
  });
  const wait = { now: () => t, sleep: async (ms: number) => void (delays.push(ms), (t += ms)) };
  return { client, wait, delays };
}

describe("waitForApproval", () => {
  it("resolves as soon as the intent exists on-chain", async () => {
    const { client, wait, delays } = harness({ intentAppearsAfterPolls: 3 });
    await client.waitForApproval(pending, wait);
    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("backs off exponentially up to maxDelayMs and then rejects with ApprovalTimeoutError", async () => {
    const { client, wait, delays } = harness();
    const err = await client.waitForApproval(pending, { ...wait, timeoutMs: 30_000 }).catch((e) => e);
    expect(err).toBeInstanceOf(ApprovalTimeoutError);
    expect(err.message).toContain(pending.approvalId);
    expect(err.message).toContain("30000");
    expect(delays).toEqual([1000, 2000, 4000, 8000, 8000, 7000]);
  });

  it("rejects right away when the backend says denied", async () => {
    const { client, wait, delays } = harness({ backend: () => "denied" });
    await expect(client.waitForApproval(pending, wait)).rejects.toBeInstanceOf(ApprovalDeniedError);
    expect(delays).toEqual([]);
  });

  it("ignores backend failures and keeps trusting the chain", async () => {
    const { client, wait } = harness({ intentAppearsAfterPolls: 2, backend: () => new Error("offline") });
    await client.waitForApproval(pending, wait);
  });

  it("an approved hint without the on-chain intent does not resolve", async () => {
    const { client, wait } = harness({ backend: () => "approved" });
    await expect(client.waitForApproval(pending, { ...wait, timeoutMs: 5_000 })).rejects.toBeInstanceOf(ApprovalTimeoutError);
  });
});

describe("executeApproved", () => {
  it("takes only the pending approval: no amount, no recipient", () => {
    expectTypeOf<PulsoClient["executeApproved"]>().parameters.toEqualTypeOf<[pending: PendingApproval]>();
    expect(PublicKey).toBeDefined();
  });
});
