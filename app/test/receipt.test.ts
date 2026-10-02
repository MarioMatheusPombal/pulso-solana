import { Keypair, PublicKey } from "@solana/web3.js";
import type { Connection } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { findPolicyPda, findVaultPda, PROGRAM_ID } from "@pulso/sdk/src/pda.js";
import { computeActionHash, INSTRUCTION_EXECUTE_TRANSFER } from "@pulso/sdk/src/intent.js";
import { describeRpc, loadReceipt } from "../lib/receipt";

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
const amount = 1_500_000n;
const expiresAt = 1_800_000_000n;

function ixData() {
  const d = new Uint8Array(32);
  d.set([233, 126, 160, 184, 235, 206, 31, 119]);
  new DataView(d.buffer).setBigUint64(8, amount, true);
  d.set(nonce, 16);
  return d;
}

const actionHash = computeActionHash({
  programId: PROGRAM_ID, instruction: INSTRUCTION_EXECUTE_TRANSFER, authority: human, agent, mint, amount, recipient, maxUses: 1, nonce, expiresAt,
});
const intent = PublicKey.findProgramAddressSync([Buffer.from("intent"), human.toBytes(), actionHash], PROGRAM_ID)[0];

function policyData() {
  const d = new Uint8Array(120);
  d.set([148, 193, 218, 129, 21, 96, 195, 77]);
  d.set(human.toBytes(), 8);
  d.set(agent.toBytes(), 40);
  return d;
}

function intentData() {
  const d = new Uint8Array(126);
  d.set([150, 220, 148, 182, 20, 199, 128, 11]);
  d.set(human.toBytes(), 8);
  d.set(agent.toBytes(), 40);
  d.set(actionHash, 72);
  const v = new DataView(d.buffer);
  v.setBigInt64(112, expiresAt, true);
  v.setUint16(120, 1, true);
  return d;
}

const account = (data: Uint8Array) => ({ owner: PROGRAM_ID, data: Buffer.from(data), lamports: 1, executable: false });

/** Fake RPC: a PULSO execute_transfer in autonomous or approved mode. */
function conn(mode: "autonomous" | "approved", getTransaction?: () => Promise<unknown>, decimals = 6): Connection {
  const keys = [agent, policy, vault, recipient, TOKEN, PROGRAM_ID, intent];
  const tx = {
    slot: 42,
    blockTime: 1_700_000_000,
    transaction: {
      message: {
        header: { numRequiredSignatures: 1 },
        staticAccountKeys: keys,
        compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: mode === "approved" ? [0, 1, 2, 3, 4, 6] : [0, 1, 2, 3, 4], data: ixData() }],
      },
    },
    meta: {
      err: null,
      preTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: "0", decimals } }],
      postTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: amount.toString(), decimals } }],
    },
  };
  return {
    getTransaction: getTransaction ?? (async () => tx),
    getAccountInfo: async (k: PublicKey) => {
      if (k.equals(policy)) return account(policyData());
      if (k.equals(intent)) return account(intentData());
      return null;
    },
  } as unknown as Connection;
}

const DEVNET = "https://api.devnet.solana.com";

describe("loadReceipt", () => {
  it("shows an autonomous receipt without a challenge", async () => {
    const v = await loadReceipt(conn("autonomous"), SIG, DEVNET);
    expect(v).toMatchObject({ ok: true, amountUnits: "1.50", rpc: "devnet · api.devnet.solana.com" });
    if (!v.ok) return;
    expect(v.receipt).toMatchObject({
      mode: "autonomous", human: human.toBase58(), agent: agent.toBase58(), recipient: recipient.toBase58(), mint: mint.toBase58(),
      amount: "1500000", decimals: 6, slot: 42, cluster: "devnet", nonce: "0102030405060708090a0b0c0d0e0f10",
    });
    expect(v.receipt.hashVerified).toBeUndefined();
  });

  it("shows an approved receipt with intent and verified hash", async () => {
    const v = await loadReceipt(conn("approved"), SIG, DEVNET);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.receipt).toMatchObject({ mode: "approved", intent: intent.toBase58(), hashVerified: true });
    expect(v.receipt.actionHash).toBe(Buffer.from(actionHash).toString("hex"));
  });

  it("propagates the typed reason of an invalid receipt", async () => {
    const bad = conn("approved");
    (bad as unknown as { getAccountInfo: unknown }).getAccountInfo = async (k: PublicKey) => (k.equals(policy) ? account(policyData()) : null);
    expect(await loadReceipt(bad, SIG, DEVNET)).toMatchObject({ ok: false, reason: "INTENT_INVALID", retry: false });
    expect(await loadReceipt(conn("autonomous"), "nope", DEVNET)).toMatchObject({ ok: false, reason: "TX_NOT_FOUND", retry: true });
  });

  it("formats the amount with the decimals read from the chain", async () => {
    const v = await loadReceipt(conn("autonomous", undefined, 9), SIG, DEVNET);
    expect(v).toMatchObject({ ok: true, amountUnits: "0.0015", receipt: { decimals: 9, amount: "1500000" } });
  });

  it("is an error, never valid, when the RPC is down", async () => {
    const down = conn("autonomous", async () => {
      throw new Error("node down");
    });
    expect(await loadReceipt(down, SIG, DEVNET)).toMatchObject({ ok: false, reason: "RPC_ERROR", detail: "node down", retry: true });
  });
});

describe("describeRpc", () => {
  it("shows cluster and host, never the full URL", () => {
    expect(describeRpc("https://devnet.helius-rpc.com/?api-key=SECRET").rpc).toBe("devnet · devnet.helius-rpc.com");
    expect(describeRpc("http://127.0.0.1:8899").cluster).toBe("localnet");
    expect(describeRpc("garbage").rpc).toBe("custom · unknown");
  });
});
