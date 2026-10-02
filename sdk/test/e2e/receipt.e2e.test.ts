import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Keypair, LAMPORTS_PER_SOL, type Connection, PublicKey } from "@solana/web3.js";
import { BN } from "@anchor-lang/core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PulsoClient, type PendingApproval } from "../../src/client.js";
import { findPolicyPda, getProgram, PROGRAM_ID } from "../../src/program.js";
import { ChallengeLedger, describeAuthorityReceipt, verifyAuthorityReceipt } from "../../src/receipt.js";
import { startValidator, type LocalValidator } from "./validator.js";

const T = (n: number) => BigInt(n) * 1_000_000n;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

let v: LocalValidator;
let connection: Connection;
const human = Keypair.generate();
const agent = Keypair.generate();
let client: PulsoClient;
let mint: PublicKey;
let recipient: PublicKey;

beforeAll(async () => {
  v = await startValidator();
  connection = v.connection;
  for (const k of [human, agent]) {
    await connection.confirmTransaction(await connection.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
  }
  mint = await createMint(connection, human, human.publicKey, null, 6);
  recipient = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address;
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

describe("authority receipt (issue 282)", () => {
  it("autonomous payment: receipt matches field by field; absent intent and token balances as the spec assumes", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue({ recipient, mint, minAmount: T(5), ttlSeconds: 60, cluster: "localnet" });
    const nonce = Uint8Array.from(Buffer.from(c.nonce, "hex"));
    const paid = await client.execute({ amount: T(5), recipient, nonce });
    expect(paid.status).toBe("executed");
    const { signature } = paid as { signature: string };

    // (a) what the absent optional accounts look like in the real transaction.
    const tx = (await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))!;
    const ci = tx.transaction.message.compiledInstructions[0]!;
    const keys = tx.transaction.message.staticAccountKeys;
    // Anchor fills an absent optional account with the program id, so the list keeps all 7 positions.
    expect(ci.accountKeyIndexes).toHaveLength(7);
    expect(keys[ci.accountKeyIndexes[5]]?.equals(PROGRAM_ID)).toBe(true);
    expect(keys[ci.accountKeyIndexes[6]]?.equals(PROGRAM_ID)).toBe(true);
    // (b) the recipient token account appears in pre/post token balances.
    const ri = ci.accountKeyIndexes[3]!;
    expect(tx.meta!.preTokenBalances!.some((b) => b.accountIndex === ri)).toBe(true);
    expect(tx.meta!.postTokenBalances!.some((b) => b.accountIndex === ri)).toBe(true);

    const r = await ledger.redeem(connection, signature, c.nonce);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receipt).toMatchObject({
      signature, cluster: "localnet", commitment: "confirmed", programId: PROGRAM_ID.toBase58(),
      policy: client.policy.toBase58(), vault: client.vault.toBase58(), human: human.publicKey.toBase58(),
      agent: agent.publicKey.toBase58(), mint: mint.toBase58(), recipient: recipient.toBase58(),
      amount: T(5).toString(), decimals: 6, nonce: c.nonce, mode: "autonomous", slot: tx.slot,
    });
    expect(r.receipt.intent).toBeUndefined();
    expect(r.receipt.hashVerified).toBeUndefined();
    expect(await ledger.redeem(connection, signature, c.nonce)).toMatchObject({ ok: false, reason: "CHALLENGE_CONSUMED" });
    const e = { recipient, mint, minAmount: T(5), nonce };
    expect(await verifyAuthorityReceipt(connection, signature, { ...e, requireApproved: true })).toMatchObject({ ok: false, reason: "APPROVAL_REQUIRED" });
    expect(await verifyAuthorityReceipt(connection, signature, { ...e, acceptedAuthorities: [agent.publicKey] })).toMatchObject({
      ok: false,
      reason: "AUTHORITY_NOT_ACCEPTED",
    });
  });

  it("approved payment: receipt carries the intent and a verified hash", async () => {
    const ledger = new ChallengeLedger();
    const c = ledger.issue({ recipient, mint, minAmount: T(100), ttlSeconds: 60 });
    const nonce = Uint8Array.from(Buffer.from(c.nonce, "hex"));
    const pending = (await client.execute({ amount: T(100), recipient, nonce })) as PendingApproval;
    expect(pending.status).toBe("HUMAN_INTENT_REQUIRED");
    expect(pending.intent.nonce).toEqual(nonce);
    await getProgram(connection, human)
      .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
      .accountsPartial({ authority: human.publicKey, policy: client.policy })
      .rpc();
    const { signature } = await client.executeApproved(pending);

    const expected = { recipient, mint, minAmount: T(100), nonce, requireApproved: true, acceptedAuthorities: [human.publicKey] };
    const r = await ledger.redeem(connection, signature, c.nonce, { requireApproved: true, acceptedAuthorities: [human.publicKey] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receipt).toMatchObject({
      signature, commitment: "confirmed", human: human.publicKey.toBase58(), agent: agent.publicKey.toBase58(),
      mint: mint.toBase58(), recipient: recipient.toBase58(), amount: T(100).toString(), nonce: hex(pending.intent.nonce),
      mode: "approved", actionHash: hex(pending.intent.actionHash), hashVerified: true,
    });
    expect(r.receipt.intent).toBeDefined();

    // The same transaction against a different challenge fails closed.
    expect(await verifyAuthorityReceipt(connection, signature, { ...expected, minAmount: T(101) })).toMatchObject({ reason: "AMOUNT_TOO_LOW" });
    expect(await verifyAuthorityReceipt(connection, signature, { ...expected, mint: Keypair.generate().publicKey })).toMatchObject({ reason: "MINT_MISMATCH" });

    // Without a challenge, the same chain data gives the same receipt (autonomous and approved).
    const d = await describeAuthorityReceipt(connection, signature, { cluster: r.receipt.cluster });
    expect(d).toEqual(r);
  });

  it("describeAuthorityReceipt: autonomous payment without a challenge", async () => {
    const nonce = Uint8Array.from(Buffer.from("0f".repeat(16), "hex"));
    const paid = await client.execute({ amount: T(3), recipient, nonce });
    expect(paid.status).toBe("executed");
    const { signature } = paid as { signature: string };
    const d = await describeAuthorityReceipt(connection, signature);
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.receipt).toMatchObject({
      signature, human: human.publicKey.toBase58(), agent: agent.publicKey.toBase58(), mint: mint.toBase58(),
      recipient: recipient.toBase58(), amount: T(3).toString(), nonce: hex(nonce), mode: "autonomous",
    });
    expect(d.receipt.hashVerified).toBeUndefined();
  });
});
