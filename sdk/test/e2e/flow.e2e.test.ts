import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, type Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ApprovalTimeoutError } from "../../src/errors.js";
import { PulsoClient, type PendingApproval } from "../../src/client.js";
import { PULSO_ERRORS, PulsoProgramError } from "../../src/errors.js";
import { computeActionHash } from "../../src/intent.js";
import { findPolicyPda, getProgram } from "../../src/program.js";
import { startValidator, type LocalValidator } from "./validator.js";

// Mint with 6 decimals; amounts below are in whole tokens.
const T = (n: number) => BigInt(n) * 1_000_000n;

let v: LocalValidator;
let connection: Connection;
const human = Keypair.generate();
const agent = Keypair.generate();
let client: PulsoClient;
let mint: PublicKey;
let recipient: PublicKey;

const balance = async (a: PublicKey) => (await getAccount(connection, a)).amount;

beforeAll(async () => {
  v = await startValidator();
  connection = v.connection;
  for (const k of [human, agent]) {
    await connection.confirmTransaction(await connection.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  }
  mint = await createMint(connection, human, human.publicKey, null, 6);
  recipient = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;

  // The human sets the policy (approval above 10, cap 500, daily 1000), creates the vault and funds it.
  const hp = getProgram(connection, human);
  const policy = findPolicyPda(human.publicKey, agent.publicKey);
  await hp.methods
    .createPolicy(new BN(T(500).toString()), new BN(T(1000).toString()), false, new BN(T(10).toString()))
    .accountsPartial({ human: human.publicKey, agent: agent.publicKey })
    .rpc();
  await hp.methods.createVault().accountsPartial({ human: human.publicKey, policy, mint }).rpc();
  client = new PulsoClient({ connection, agent, human: human.publicKey });
  await mintTo(connection, human, mint, client.vault, human, T(5000));
});

afterAll(() => v?.stop());

describe("execute (issue 105)", () => {
  it("scenario A: executes below the approval threshold", async () => {
    const before = await balance(recipient);
    const r = await client.execute({ amount: T(5), recipient });
    expect(r.status).toBe("executed");
    expect(await balance(recipient)).toBe(before + T(5));
    expect(await balance(client.vault)).toBe(T(5000) - T(5));
  });

  it("returns HUMAN_INTENT_REQUIRED without throwing above the threshold", async () => {
    const r = await client.execute({ amount: T(100), recipient });
    expect(r.status).toBe("HUMAN_INTENT_REQUIRED");
    const p = r as PendingApproval;
    expect(p.reason).toBe("HUMAN_INTENT_REQUIRED");
    expect(p.approvalUrl).toBeUndefined();
    expect(p.intent.fields.amount).toBe(T(100));
    expect(p.intent.fields.recipient.equals(recipient)).toBe(true);
    expect(p.intent.fields.authority.equals(human.publicKey)).toBe(true);
    expect(p.intent.fields.mint.equals(mint)).toBe(true);
    expect(p.intent.actionHash).toEqual(computeActionHash(p.intent.fields));
    expect(p.approvalId).toBe(Buffer.from(p.intent.actionHash).toString("hex"));
    expect(await balance(recipient)).toBe(T(5));
  });

  it("throws PulsoProgramError above the per-transaction cap", async () => {
    const err = await client.execute({ amount: T(600), recipient }).catch((e) => e);
    expect(err).toBeInstanceOf(PulsoProgramError);
    expect(err.error).toBe(PULSO_ERRORS.AmountExceedsLimit);
  });

  it("throws PolicyNotFound for a policy that does not exist", async () => {
    const ghost = new PulsoClient({ connection, agent, human: Keypair.generate().publicKey });
    const err = await ghost.execute({ amount: T(1), recipient }).catch((e) => e);
    expect(err).toBeInstanceOf(PulsoProgramError);
    expect(err.error).toBe(PULSO_ERRORS.PolicyNotFound);
  });

  it("keeps a confirmed transfer successful when optional activity logging fails", async () => {
    const telemetry = new PulsoClient({
      connection, agent, human: human.publicKey, activityUrl: "http://app.test",
      fetch: (async () => { throw new Error("activity sink unavailable"); }) as typeof fetch,
    });
    const result = await telemetry.execute({ amount: T(1), recipient });
    expect(result.status).toBe("executed");
  });

  it("posts the request and returns approvalUrl when approvalsUrl is set", async () => {
    const posted: { url: string; body: Record<string, string> }[] = [];
    const fakeFetch = (async (url: string, init: { body: string }) => {
      posted.push({ url, body: JSON.parse(init.body) });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    const c = new PulsoClient({ connection, agent, human: human.publicKey, approvalsUrl: "http://app.test/", fetch: fakeFetch });
    const r = (await c.execute({ amount: T(50), recipient })) as PendingApproval;
    expect(r.approvalUrl).toBe(`http://app.test/approvals/${r.approvalId}`);
    expect(posted).toHaveLength(1);
    expect(posted[0]!.url).toBe("http://app.test/api/approvals");
    expect(posted[0]!.body).toMatchObject({ actionHash: r.approvalId, amount: T(50).toString(), mint: mint.toBase58() });

    const failing = (async () => new Response("no", { status: 500 })) as unknown as typeof fetch;
    const c2 = new PulsoClient({ connection, agent, human: human.publicKey, approvalsUrl: "http://app.test", fetch: failing });
    await expect(c2.execute({ amount: T(50), recipient })).rejects.toThrow(/HTTP 500/);
  });
});

describe("wait and repeat (issue 107)", () => {
  it("scenario B: after the human records the intent, the exact action executes; scenario E: it cannot be reused", async () => {
    const r = (await client.execute({ amount: T(100), recipient })) as PendingApproval;
    expect(r.status).toBe("HUMAN_INTENT_REQUIRED");

    // Not approved yet: a short wait times out clearly.
    await expect(client.waitForApproval(r, { timeoutMs: 1500, initialDelayMs: 200, maxDelayMs: 400 })).rejects.toBeInstanceOf(
      ApprovalTimeoutError,
    );

    // The "human" records exactly the hash, expiry and max uses of the intent.
    await getProgram(connection, human)
      .methods.recordIntent(Array.from(r.intent.actionHash), new BN(r.intent.fields.expiresAt.toString()), r.intent.fields.maxUses)
      .accountsPartial({ authority: human.publicKey, policy: client.policy })
      .rpc();

    const events: Record<string, unknown>[] = [];
    const telemetry = new PulsoClient({
      connection, agent, human: human.publicKey, activityUrl: "http://app.test/",
      fetch: (async (_url: string, init: RequestInit) => {
        events.push(JSON.parse(String(init.body)));
        return new Response("ok", { status: 201 });
      }) as typeof fetch,
    });
    await telemetry.waitForApproval(r, { timeoutMs: 10_000, initialDelayMs: 100, maxDelayMs: 400 });
    const before = await balance(recipient);
    const vaultBefore = await balance(client.vault);
    const done = await telemetry.executeApproved(r);
    expect(done.status).toBe("executed");
    expect(await balance(recipient)).toBe(before + T(100));
    expect(await balance(client.vault)).toBe(vaultBefore - T(100));

    const err = await telemetry.executeApproved(r).catch((e) => e);
    expect(err).toBeInstanceOf(PulsoProgramError);
    expect(err.error).toBe(PULSO_ERRORS.IntentAlreadyUsed);
    expect(events.map((event) => event.status)).toEqual(["approved", "executed", "rejected"]);
    expect(events[0]).toMatchObject({ evidence: "chain_account_observed", actionHash: r.approvalId });
    expect(events[1]).toMatchObject({ evidence: "confirmed_transaction", actionHash: r.approvalId, signature: done.signature });
    expect(events[2]).toMatchObject({ evidence: "simulation", actionHash: r.approvalId, code: "PULSO_005_INTENT_ALREADY_USED" });
  });

  it("executeAndWait runs the whole cycle while the human approves from the posted request", async () => {
    let req: Record<string, string | number> | undefined;
    const fakeFetch = (async (_url: string, init?: { body?: string }) => {
      if (init?.body) req = JSON.parse(init.body);
      return new Response(JSON.stringify({ status: "pending" }), { status: 201 });
    }) as unknown as typeof fetch;
    const c = new PulsoClient({ connection, agent, human: human.publicKey, approvalsUrl: "http://app.test", fetch: fakeFetch });
    const before = await balance(recipient);
    const run = c.executeAndWait({ amount: T(20), recipient }, { initialDelayMs: 100, maxDelayMs: 200, timeoutMs: 30_000 });
    while (!req) await new Promise((r) => setTimeout(r, 50));
    await getProgram(connection, human)
      .methods.recordIntent(Array.from(Buffer.from(String(req.actionHash), "hex")), new BN(String(req.expiresAt)), Number(req.maxUses))
      .accountsPartial({ authority: human.publicKey, policy: c.policy })
      .rpc();
    expect((await run).status).toBe("executed");
    expect(await balance(recipient)).toBe(before + T(20));
  });
});
