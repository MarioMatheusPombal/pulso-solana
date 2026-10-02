import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { startValidator, type LocalValidator } from "../agent-demo/src/validator.js";
import {
  ChallengeLedger,
  findIntentPda,
  findPolicyPda,
  generateNonce,
  getProgram,
  PROGRAM_ID,
  PulsoClient,
  verifyAuthorityReceipt,
  type PendingApproval,
  type ReceiptConnection,
} from "../sdk/src/index.js";

// Issue 283: every attack on the authority receipt must be refused, with the reason the spec names
// (docs/AUTHORITY_RECEIPT_SPEC.md section 5). Real transactions on a local validator, except
// the four tests whose name says "fabricated response": those wrap the real connection and tamper
// with the answer, because we do not build a fake program.

const T = (n: number) => BigInt(n) * 1_000_000n;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const unhex = (s: string) => Uint8Array.from(Buffer.from(s, "hex"));

let v: LocalValidator;
let connection: Connection;
const human = Keypair.generate();
const agent = Keypair.generate();
let client: PulsoClient;
let mint: PublicKey;
let recipient: PublicKey;

async function fund(k: Keypair) {
  await connection.confirmTransaction(await connection.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
}

/** Policy + funded vault for a (human, agent) pair. */
async function setupPolicy(h: Keypair, a: Keypair): Promise<PulsoClient> {
  const hp = getProgram(connection, h);
  const policy = findPolicyPda(h.publicKey, a.publicKey);
  await hp.methods
    .createPolicy(new BN(T(500).toString()), new BN(T(5000).toString()), false, new BN(T(10).toString()))
    .accountsPartial({ human: h.publicKey, agent: a.publicKey })
    .rpc();
  await hp.methods.createVault().accountsPartial({ human: h.publicKey, policy, mint }).rpc();
  const c = new PulsoClient({ connection, agent: a, human: h.publicKey });
  await mintTo(connection, h, mint, c.vault, human, T(2000));
  return c;
}

/** Autonomous payment through PULSO bound to a fresh challenge nonce. */
async function payAutonomous(amount = T(5), c = client, to = recipient) {
  const nonce = generateNonce();
  const r = await c.execute({ amount, recipient: to, nonce });
  expect(r.status).toBe("executed");
  return { signature: (r as { signature: string }).signature, nonce };
}

/** Approved payment: above the approval threshold, human records the intent, agent repeats it. */
async function payApproved(amount = T(100)) {
  const nonce = generateNonce();
  const pending = (await client.execute({ amount, recipient, nonce })) as PendingApproval;
  expect(pending.status).toBe("HUMAN_INTENT_REQUIRED");
  await getProgram(connection, human)
    .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
    .accountsPartial({ authority: human.publicKey, policy: client.policy })
    .rpc();
  const { signature } = await client.executeApproved(pending);
  return { signature, nonce, pending };
}

const expectedFor = (nonce: Uint8Array, minAmount = T(5)) => ({ recipient, mint, minAmount, nonce });

/** Wraps the real connection; `tx` and `account` may rewrite what the "node" answers. */
function tamper(o: {
  tx?: (tx: any) => any;
  account?: (key: PublicKey, info: any) => any;
}): ReceiptConnection {
  return {
    getTransaction: async (...a: any[]) => {
      const tx = await (connection.getTransaction as any)(...a);
      return tx && o.tx ? o.tx(tx) : tx;
    },
    getAccountInfo: async (...a: any[]) => {
      const info = await (connection.getAccountInfo as any)(...a);
      return info && o.account ? o.account(a[0], info) : info;
    },
  } as unknown as ReceiptConnection;
}

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Uint8Array): string {
  let n = BigInt("0x" + hex(bytes));
  let s = "";
  while (n > 0n) {
    s = B58[Number(n % 58n)] + s;
    n /= 58n;
  }
  return s;
}

beforeAll(async () => {
  v = await startValidator({
    programId: PROGRAM_ID.toBase58(),
    soPath: resolve(import.meta.dirname, "../target/deploy/pulso.so"),
    rpcPort: 8997,
    faucetPort: 9997,
  });
  connection = v.connection;
  await fund(human);
  await fund(agent);
  mint = await createMint(connection, human, human.publicKey, null, 6);
  recipient = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;
  client = await setupPolicy(human, agent);
});

afterAll(() => v?.stop());

describe("controls: the suite does not refuse everything (issue 283)", () => {
  it("accepts an autonomous payment", async () => {
    const { signature, nonce } = await payAutonomous();
    const r = await verifyAuthorityReceipt(connection, signature, expectedFor(nonce));
    expect(r).toMatchObject({ ok: true, receipt: { mode: "autonomous", human: human.publicKey.toBase58(), nonce: hex(nonce) } });
  });

  it("accepts an approved payment", async () => {
    const { signature, nonce } = await payApproved();
    const r = await verifyAuthorityReceipt(connection, signature, { ...expectedFor(nonce, T(100)), requireApproved: true, acceptedAuthorities: [human.publicKey] });
    expect(r).toMatchObject({ ok: true, receipt: { mode: "approved", hashVerified: true } });
  });
});

describe("real transactions refused (issue 283)", () => {
  it("1. direct SPL transfer by the agent, without PULSO, is NOT_PULSO_TRANSFER (and the money did arrive)", async () => {
    const agentAta = (await getOrCreateAssociatedTokenAccount(connection, agent, mint, agent.publicKey)).address;
    await mintTo(connection, human, mint, agentAta, human, T(50));
    const before = (await getAccount(connection, recipient)).amount;
    const signature = await transfer(connection, agent, agentAta, recipient, agent, T(5));
    expect((await getAccount(connection, recipient)).amount - before).toBe(T(5));
    const r = await verifyAuthorityReceipt(connection, signature, expectedFor(generateNonce()));
    expect(r).toMatchObject({ ok: false, reason: "NOT_PULSO_TRANSFER" });
  });

  it("2. receipt of another request: nonce A presented for challenge B is NONCE_MISMATCH, and B stays open", async () => {
    const ledger = new ChallengeLedger();
    const a = await payAutonomous();
    const b = ledger.issue({ recipient, mint, minAmount: T(5), ttlSeconds: 60 });
    expect(await verifyAuthorityReceipt(connection, a.signature, expectedFor(unhex(b.nonce)))).toMatchObject({ ok: false, reason: "NONCE_MISMATCH" });
    expect(await ledger.redeem(connection, a.signature, b.nonce)).toMatchObject({ ok: false, reason: "NONCE_MISMATCH" });
    // B was not burned by the refusal: the payment that does carry B's nonce still redeems it.
    const paidB = await client.execute({ amount: T(5), recipient, nonce: unhex(b.nonce) });
    expect(await ledger.redeem(connection, (paidB as { signature: string }).signature, b.nonce)).toMatchObject({ ok: true });
  });

  it("3. the same receipt presented twice to the same challenge is CHALLENGE_CONSUMED", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue({ recipient, mint, minAmount: T(5), ttlSeconds: 60 });
    const paid = await client.execute({ amount: T(5), recipient, nonce: unhex(c.nonce) });
    const { signature } = paid as { signature: string };
    expect(await ledger.redeem(connection, signature, c.nonce)).toMatchObject({ ok: true });
    expect(await ledger.redeem(connection, signature, c.nonce)).toMatchObject({ ok: false, reason: "CHALLENGE_CONSUMED" });
  });

  it("4a. amount lower than required is AMOUNT_TOO_LOW", async () => {
    const { signature, nonce } = await payAutonomous(T(5));
    expect(await verifyAuthorityReceipt(connection, signature, expectedFor(nonce, T(6)))).toMatchObject({ ok: false, reason: "AMOUNT_TOO_LOW" });
  });

  it("4b. different recipient is RECIPIENT_MISMATCH", async () => {
    const { signature, nonce } = await payAutonomous();
    const other = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;
    expect(await verifyAuthorityReceipt(connection, signature, { ...expectedFor(nonce), recipient: other })).toMatchObject({ ok: false, reason: "RECIPIENT_MISMATCH" });
  });

  it("4c. different mint is MINT_MISMATCH", async () => {
    const { signature, nonce } = await payAutonomous();
    expect(await verifyAuthorityReceipt(connection, signature, { ...expectedFor(nonce), mint: Keypair.generate().publicKey })).toMatchObject({ ok: false, reason: "MINT_MISMATCH" });
  });

  it("5. transaction that failed with a PULSO error, confirmed on chain, is TX_FAILED", async () => {
    const nonce = generateNonce();
    // 600 > max_per_transaction (500): PULSO_008_AMOUNT_EXCEEDS_LIMIT. Sent without preflight so it lands on chain.
    const ix = await getProgram(connection, agent)
      .methods.executeTransfer(new BN(T(600).toString()), Array.from(nonce))
      .accountsPartial({
        agent: agent.publicKey, policy: client.policy, vault: client.vault, recipient,
        tokenProgram: TOKEN_PROGRAM_ID, intent: null, recipientApproval: null,
      })
      .instruction();
    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction().add(ix);
    tx.feePayer = agent.publicKey;
    tx.recentBlockhash = latest.blockhash;
    tx.sign(agent);
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await connection.confirmTransaction({ signature, ...latest }, "confirmed");
    const onChain = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(onChain?.meta?.err).toEqual({ InstructionError: [0, { Custom: 6007 }] });
    expect(await verifyAuthorityReceipt(connection, signature, expectedFor(nonce, T(600)))).toMatchObject({ ok: false, reason: "TX_FAILED" });
  });

  it("6. authority outside acceptedAuthorities is AUTHORITY_NOT_ACCEPTED", async () => {
    const { signature, nonce } = await payAutonomous();
    const r = await verifyAuthorityReceipt(connection, signature, { ...expectedFor(nonce), acceptedAuthorities: [Keypair.generate().publicKey] });
    expect(r).toMatchObject({ ok: false, reason: "AUTHORITY_NOT_ACCEPTED" });
  });

  it("7. requireApproved with an autonomous transfer is APPROVAL_REQUIRED", async () => {
    const { signature, nonce } = await payAutonomous();
    expect(await verifyAuthorityReceipt(connection, signature, { ...expectedFor(nonce), requireApproved: true })).toMatchObject({ ok: false, reason: "APPROVAL_REQUIRED" });
  });

  it("8. policy whose human and agent are the same key is POLICY_INVALID", async () => {
    const attacker = Keypair.generate();
    await fund(attacker);
    const own = await setupPolicy(attacker, attacker);
    const { signature, nonce } = await payAutonomous(T(5), own);
    const r = await verifyAuthorityReceipt(connection, signature, expectedFor(nonce));
    expect(r).toMatchObject({ ok: false, reason: "POLICY_INVALID" });
    expect((r as { detail?: string }).detail).toContain("same key");
  });

  it("9a. expired challenge is CHALLENGE_EXPIRED", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue({ recipient, mint, minAmount: T(5), ttlSeconds: 1 });
    const paid = await client.execute({ amount: T(5), recipient, nonce: unhex(c.nonce) });
    const now = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(now + 5_000);
    try {
      expect(await ledger.redeem(connection, (paid as { signature: string }).signature, c.nonce)).toMatchObject({ ok: false, reason: "CHALLENGE_EXPIRED" });
    } finally {
      spy.mockRestore();
    }
  });

  it("9b. nonce never issued is CHALLENGE_UNKNOWN", async () => {
    const { signature, nonce } = await payAutonomous();
    expect(await new ChallengeLedger().redeem(connection, signature, hex(nonce))).toMatchObject({ ok: false, reason: "CHALLENGE_UNKNOWN" });
  });

  it("10a. RPC unavailable is RPC_ERROR, never provisional acceptance, and the challenge stays open", async () => {
    const { signature, nonce } = await payAutonomous();
    const dead = new Connection("http://127.0.0.1:1", "confirmed");
    expect(await verifyAuthorityReceipt(dead, signature, expectedFor(nonce))).toMatchObject({ ok: false, reason: "RPC_ERROR" });

    const ledger = new ChallengeLedger();
    const c = ledger.issue({ recipient, mint, minAmount: T(5), ttlSeconds: 60 });
    expect(await ledger.redeem(dead, signature, c.nonce)).toMatchObject({ ok: false, reason: "RPC_ERROR" });
    const paid = await client.execute({ amount: T(5), recipient, nonce: unhex(c.nonce) });
    expect(await ledger.redeem(connection, (paid as { signature: string }).signature, c.nonce)).toMatchObject({ ok: true });
  });

  it("10b. well-formed signature that does not exist on chain is TX_NOT_FOUND", async () => {
    const bytes = crypto.getRandomValues(new Uint8Array(64));
    bytes[0] = 0xff; // keeps the base58 form at 87-88 characters
    const r = await verifyAuthorityReceipt(connection, base58(bytes), expectedFor(generateNonce()));
    expect(r).toMatchObject({ ok: false, reason: "TX_NOT_FOUND" });
    expect((r as { detail?: string }).detail).toBeUndefined();
  });
});

describe("fabricated response: the real connection is wrapped and the answer tampered with (issue 283)", () => {
  it("12. fabricated response: PULSO instruction under another program id, same data, accounts and logs, is NOT_PULSO_TRANSFER", async () => {
    const { signature, nonce } = await payAutonomous();
    const fake = Keypair.generate().publicKey;
    const wrapped = tamper({
      tx: (tx) => {
        const msg = tx.transaction.message;
        const keys = [...msg.staticAccountKeys, fake];
        const compiledInstructions = msg.compiledInstructions.map((ix: any) => ({ ...ix, programIdIndex: keys.length - 1 }));
        const message = Object.create(msg, { staticAccountKeys: { value: keys }, compiledInstructions: { value: compiledInstructions } });
        return { ...tx, transaction: { ...tx.transaction, message } };
      },
    });
    // Control: the wrapper alone changes nothing, and the logs still look like PULSO.
    const seen = await wrapped.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    expect(seen?.meta?.logMessages?.some((l) => l.includes(`Program ${PROGRAM_ID.toBase58()} invoke`))).toBe(true);
    expect(seen?.meta?.logMessages?.some((l) => l.startsWith("Program data:"))).toBe(true);
    expect(await verifyAuthorityReceipt(tamper({}), signature, expectedFor(nonce))).toMatchObject({ ok: true });
    expect(await verifyAuthorityReceipt(wrapped, signature, expectedFor(nonce))).toMatchObject({ ok: false, reason: "NOT_PULSO_TRANSFER" });
  });

  it("13. fabricated response: policy account not owned by the program is POLICY_INVALID", async () => {
    const { signature, nonce } = await payAutonomous();
    const wrapped = tamper({
      account: (key, info) => (key.equals(client.policy) ? { ...info, owner: Keypair.generate().publicKey } : info),
    });
    expect(await verifyAuthorityReceipt(wrapped, signature, expectedFor(nonce))).toMatchObject({ ok: false, reason: "POLICY_INVALID" });
  });

  it("14. fabricated response: intent with a swapped action_hash is HASH_MISMATCH", async () => {
    const { signature, nonce, pending } = await payApproved();
    const intentKey = findIntentPda(human.publicKey, pending.intent.actionHash);
    const wrapped = tamper({
      account: (key, info) => {
        if (!key.equals(intentKey)) return info;
        const data = Buffer.from(info.data);
        data[72] ^= 0xff;
        return { ...info, data };
      },
    });
    expect(await verifyAuthorityReceipt(wrapped, signature, expectedFor(nonce, T(100)))).toMatchObject({ ok: false, reason: "HASH_MISMATCH" });
  });

  it("15a. fabricated response: node omitting postTokenBalances is MINT_MISMATCH", async () => {
    const { signature, nonce } = await payAutonomous();
    const wrapped = tamper({ tx: (tx) => ({ ...tx, meta: { ...tx.meta, postTokenBalances: undefined } }) });
    expect(await verifyAuthorityReceipt(wrapped, signature, expectedFor(nonce))).toMatchObject({ ok: false, reason: "MINT_MISMATCH" });
  });

  it("15b. fabricated response: node omitting preTokenBalances is BALANCE_MISMATCH", async () => {
    const { signature, nonce } = await payAutonomous();
    const wrapped = tamper({ tx: (tx) => ({ ...tx, meta: { ...tx.meta, preTokenBalances: undefined } }) });
    expect(await verifyAuthorityReceipt(wrapped, signature, expectedFor(nonce))).toMatchObject({ ok: false, reason: "BALANCE_MISMATCH" });
  });
});
