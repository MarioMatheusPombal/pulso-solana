import { Keypair, PublicKey } from "@solana/web3.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ChallengeLedger, createPaymentChallenge, describeAuthorityReceipt, verifyAuthorityReceipt, type ReceiptConnection } from "../src/receipt.js";
import { findPolicyPda, findVaultPda, PROGRAM_ID } from "../src/pda.js";

const key = () => Keypair.generate().publicKey;
const TOKEN = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SIG = "1".repeat(87);
const human = key();
const agent = key();
const mint = key();
const recipient = key();
const policy = findPolicyPda(human, agent);
const vault = findVaultPda(policy);
const nonce = Uint8Array.from({ length: 16 }, (_, i) => i + 1);

function ixData(amount: bigint, n: Uint8Array) {
  const d = new Uint8Array(32);
  d.set([233, 126, 160, 184, 235, 206, 31, 119]);
  new DataView(d.buffer).setBigUint64(8, amount, true);
  d.set(n, 16);
  return d;
}

function policyData(h = human) {
  const d = new Uint8Array(120);
  d.set([148, 193, 218, 129, 21, 96, 195, 77]);
  d.set(h.toBytes(), 8);
  d.set(agent.toBytes(), 40);
  return d;
}

/** Autonomous transfer of `amount` to `recipient`, as the RPC would report it. */
function fakeTx(over: { program?: PublicKey; amount?: bigint; err?: unknown } = {}) {
  const program = over.program ?? PROGRAM_ID;
  const amount = over.amount ?? 1_000_000n;
  // 0 agent, 1 policy, 2 vault, 3 recipient, 4 token program, 5 program
  const keys = [agent, policy, vault, recipient, TOKEN, program];
  return {
    slot: 10,
    blockTime: 1_700_000_000,
    transaction: {
      message: {
        header: { numRequiredSignatures: 1 },
        staticAccountKeys: keys,
        compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: [0, 1, 2, 3, 4], data: ixData(amount, nonce) }],
      },
    },
    meta: {
      err: over.err ?? null,
      preTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: "0", decimals: 6 } }],
      postTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: amount.toString(), decimals: 6 } }],
    },
  };
}

function conn(tx: unknown, getTransaction?: () => Promise<unknown>): ReceiptConnection {
  return {
    getTransaction: getTransaction ?? (async () => tx),
    getAccountInfo: async (k: PublicKey) =>
      k.equals(policy) ? { owner: PROGRAM_ID, data: Buffer.from(policyData()), lamports: 1, executable: false } : null,
  } as unknown as ReceiptConnection;
}

const expected = { recipient, mint, minAmount: 1_000_000n, nonce };

describe("verifyAuthorityReceipt", () => {
  it("returns RPC_ERROR when the RPC fails", async () => {
    const c = conn(null, async () => { throw new Error("node down"); });
    expect(await verifyAuthorityReceipt(c, SIG, expected)).toEqual({ ok: false, reason: "RPC_ERROR", detail: "node down" });
  });

  it("returns TX_NOT_FOUND for a null transaction and for a malformed signature", async () => {
    expect(await verifyAuthorityReceipt(conn(null), SIG, expected)).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
    expect(await verifyAuthorityReceipt(conn(fakeTx()), "nope", expected)).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
  });

  it("returns TX_FAILED when meta.err is set", async () => {
    const r = await verifyAuthorityReceipt(conn(fakeTx({ err: { InstructionError: [0, "Custom"] } })), SIG, expected);
    expect(r).toMatchObject({ ok: false, reason: "TX_FAILED" });
  });

  it("returns NOT_PULSO_TRANSFER for the same bytes sent to another program", async () => {
    const r = await verifyAuthorityReceipt(conn(fakeTx({ program: key() })), SIG, expected);
    expect(r).toMatchObject({ ok: false, reason: "NOT_PULSO_TRANSFER" });
  });

  it("refuses an unreadable response instead of throwing", async () => {
    expect(await verifyAuthorityReceipt(conn({ slot: 1, meta: {} }), SIG, expected)).toMatchObject({ ok: false });
  });

  it("returns POLICY_INVALID when human and agent are the same key", async () => {
    const p = findPolicyPda(agent, agent);
    const tx = fakeTx();
    tx.transaction.message.staticAccountKeys[1] = p;
    tx.transaction.message.staticAccountKeys[2] = findVaultPda(p);
    const c = {
      getTransaction: async () => tx,
      getAccountInfo: async () => ({ owner: PROGRAM_ID, data: Buffer.from(policyData(agent)), lamports: 1, executable: false }),
    } as unknown as ReceiptConnection;
    expect(await verifyAuthorityReceipt(c, SIG, expected)).toMatchObject({
      ok: false, reason: "POLICY_INVALID", detail: "policy human and agent are the same key",
    });
  });

  it("rejects processed commitment", async () => {
    await expect(verifyAuthorityReceipt(conn(fakeTx()), SIG, expected, { commitment: "processed" as never })).rejects.toThrow(RangeError);
  });

  it("builds a receipt for a valid autonomous transfer", async () => {
    const r = await verifyAuthorityReceipt(conn(fakeTx()), SIG, expected, { cluster: "localnet" });
    expect(r).toEqual({
      ok: true,
      receipt: {
        signature: SIG, cluster: "localnet", commitment: "confirmed", slot: 10, blockTime: 1_700_000_000,
        programId: PROGRAM_ID.toBase58(), policy: policy.toBase58(), human: human.toBase58(), agent: agent.toBase58(),
        vault: vault.toBase58(), mint: mint.toBase58(), decimals: 6, recipient: recipient.toBase58(), amount: "1000000",
        nonce: "0102030405060708090a0b0c0d0e0f10", mode: "autonomous",
      },
    });
  });
});

describe("describeAuthorityReceipt", () => {
  it("builds the same receipt as verifyAuthorityReceipt without a challenge", async () => {
    const withChallenge = await verifyAuthorityReceipt(conn(fakeTx()), SIG, expected, { cluster: "localnet" });
    expect(await describeAuthorityReceipt(conn(fakeTx()), SIG, { cluster: "localnet" })).toEqual(withChallenge);
  });

  it("keeps the fail-closed steps that need no challenge", async () => {
    expect(await describeAuthorityReceipt(conn(null), SIG)).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
    expect(await describeAuthorityReceipt(conn(fakeTx({ err: { x: 1 } })), SIG)).toMatchObject({ ok: false, reason: "TX_FAILED" });
    expect(await describeAuthorityReceipt(conn(fakeTx({ program: key() })), SIG)).toMatchObject({ ok: false, reason: "NOT_PULSO_TRANSFER" });
    const down = conn(null, async () => { throw new Error("node down"); });
    expect(await describeAuthorityReceipt(down, SIG)).toEqual({ ok: false, reason: "RPC_ERROR", detail: "node down" });
  });

  it("refuses a transaction with two execute_transfer instructions", async () => {
    const tx = fakeTx();
    const first = tx.transaction.message.compiledInstructions[0]!;
    tx.transaction.message.compiledInstructions.push({ ...first, data: ixData(1n, Uint8Array.from({ length: 16 }, () => 9)) });
    expect(await describeAuthorityReceipt(conn(tx), SIG)).toMatchObject({ ok: false, reason: "NONCE_MISMATCH" });
  });

  it("still refuses when the recipient has no token balance to read the mint from", async () => {
    const tx = fakeTx();
    tx.meta.postTokenBalances = [];
    expect(await describeAuthorityReceipt(conn(tx), SIG)).toMatchObject({ ok: false, reason: "MINT_MISMATCH" });
  });

  it("still refuses a balance that did not grow", async () => {
    const tx = fakeTx();
    tx.meta.postTokenBalances[0]!.uiTokenAmount.amount = "1";
    expect(await describeAuthorityReceipt(conn(tx), SIG)).toMatchObject({ ok: false, reason: "BALANCE_MISMATCH" });
  });

  it("reads decimals from the transaction and refuses when they are missing", async () => {
    const tx = fakeTx();
    tx.meta.postTokenBalances[0]!.uiTokenAmount.decimals = 9;
    expect(await describeAuthorityReceipt(conn(tx), SIG)).toMatchObject({ ok: true, receipt: { decimals: 9, amount: "1000000" } });
    tx.meta.postTokenBalances[0]!.uiTokenAmount.decimals = undefined as never;
    expect(await describeAuthorityReceipt(conn(tx), SIG)).toMatchObject({ ok: false, reason: "MINT_MISMATCH" });
    expect(await verifyAuthorityReceipt(conn(tx), SIG, expected)).toMatchObject({ ok: false, reason: "MINT_MISMATCH" });
  });

  it("verifyAuthorityReceipt refuses an incomplete challenge instead of describing", async () => {
    expect(await verifyAuthorityReceipt(conn(fakeTx()), SIG, {} as never)).toMatchObject({ ok: false, reason: "RPC_ERROR" });
  });
});

describe("ChallengeLedger", () => {
  afterEach(() => vi.useRealTimers());
  const params = { recipient, mint, minAmount: 1_000_000n, ttlSeconds: 60 };
  const withNonce = (c: ReturnType<typeof createPaymentChallenge>) => {
    const n = Uint8Array.from(c.nonce.match(/../g)!, (h) => parseInt(h, 16));
    return { ...fakeTx(), transaction: { message: { ...fakeTx().transaction.message, compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: [0, 1, 2, 3, 4], data: ixData(1_000_000n, n) }] } } };
  };

  it("emits the spec challenge shape", () => {
    const c = new ChallengeLedger().issue(params);
    expect(c).toMatchObject({ scheme: "pulso-receipt-v1", programId: PROGRAM_ID.toBase58(), minAmount: "1000000", recipient: recipient.toBase58() });
    expect(c.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("refuses an unknown nonce before touching the RPC", async () => {
    const getTransaction = vi.fn();
    const r = await new ChallengeLedger().redeem({ getTransaction } as never, SIG, "00".repeat(16));
    expect(r).toMatchObject({ ok: false, reason: "CHALLENGE_UNKNOWN" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("refuses an expired challenge before touching the RPC", async () => {
    vi.useFakeTimers();
    const ledger = new ChallengeLedger();
    const c = ledger.issue(params);
    vi.advanceTimersByTime(61_000);
    const getTransaction = vi.fn();
    expect(await ledger.redeem({ getTransaction } as never, SIG, c.nonce)).toMatchObject({ ok: false, reason: "CHALLENGE_EXPIRED" });
    expect(getTransaction).not.toHaveBeenCalled();
  });

  it("a refusal leaves the challenge open; success consumes it", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue(params);
    expect(await ledger.redeem(conn(null), SIG, c.nonce)).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
    expect(await ledger.redeem(conn(withNonce(c)), SIG, c.nonce)).toMatchObject({ ok: true });
    expect(await ledger.redeem(conn(withNonce(c)), SIG, c.nonce)).toMatchObject({ ok: false, reason: "CHALLENGE_CONSUMED" });
  });

  it("only one of two concurrent redeems succeeds", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue(params);
    const tx = withNonce(c);
    const slow = conn(tx, async () => { await new Promise((r) => setTimeout(r, 20)); return tx; });
    const results = await Promise.all([ledger.redeem(slow, SIG, c.nonce), ledger.redeem(slow, SIG, c.nonce)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.find((r) => !r.ok)).toMatchObject({ reason: "CHALLENGE_CONSUMED" });
  });

  it("frees the challenge when the concurrent verification refuses", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue(params);
    const down = conn(null, async () => { throw new Error("down"); });
    expect(await ledger.redeem(down, SIG, c.nonce)).toMatchObject({ reason: "RPC_ERROR" });
    expect(await ledger.redeem(conn(withNonce(c)), SIG, c.nonce)).toMatchObject({ ok: true });
  });
});
