import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it, vi } from "vitest";
import { findIntentPda, findPolicyPda, PROGRAM_ID } from "@pulso/sdk/src/pda.js";
import { explorerUrl, matchCachedReport, verifyActivityReport, type DemoReport } from "../lib/live-demo";

const key = () => Keypair.generate().publicKey;
const sig = "1".repeat(87);
const agent = key();
const authority = key();
const policy = findPolicyPda(authority, agent);
const vault = key();
const recipient = key();
const token = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const data = new Uint8Array(32);
data.set([233, 126, 160, 184, 235, 206, 31, 119]);
new DataView(data.buffer).setBigUint64(8, 150n, true);

const report = (change: Partial<DemoReport> = {}): DemoReport => ({
  eventId: "8b6f73db-3591-4ed6-83e6-17d5db24acb1", status: "rejected", evidence: "confirmed_transaction",
  programId: PROGRAM_ID.toBase58(), policy: policy.toBase58(), amount: "150", recipient: recipient.toBase58(),
  signature: sig, code: "PULSO_006_INTENT_MISMATCH", createdAt: new Date().toISOString(), ...change,
});

function connection(options: { program?: PublicKey; err?: unknown; code?: string; failIndex?: number; accountHash?: Uint8Array } = {}) {
  const program = options.program ?? PROGRAM_ID;
  const hash = options.accountHash ?? new Uint8Array(32);
  const intent = findIntentPda(authority, hash);
  const keys = [agent, policy, vault, recipient, token, program, intent];
  const transaction = {
    slot: 10, blockTime: 1_700_000_000,
    transaction: { message: { header: { numRequiredSignatures: 1 }, staticAccountKeys: keys, compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: [0, 1, 2, 3, 4, 6], data }] } },
    meta: { err: options.err ?? { InstructionError: [options.failIndex ?? 0, { Custom: 6005 }] }, logMessages: [`Program ${PROGRAM_ID.toBase58()} invoke [1]`, `Program log: Error Code: IntentMismatch. Error Number: 6005. Error Message: ${options.code ?? "PULSO_006_INTENT_MISMATCH"}`, `Program ${PROGRAM_ID.toBase58()} failed: custom program error: 0x1775`] },
  };
  return {
    getTransaction: vi.fn(async () => transaction),
    getSignatureStatuses: vi.fn(async () => ({ value: [{ err: options.err ?? { InstructionError: [options.failIndex ?? 0, { Custom: 6005 }] }, confirmationStatus: "confirmed" }] })),
    getAccountInfo: vi.fn(async (address: PublicKey) => {
      if (!options.accountHash) return null;
      if (address.equals(policy)) {
        const data = new Uint8Array(120); data.set([148, 193, 218, 129, 21, 96, 195, 77]); data.set(authority.toBytes(), 8); data.set(agent.toBytes(), 40);
        return { owner: PROGRAM_ID, data };
      }
      const data = new Uint8Array(126); data.set([150, 220, 148, 182, 20, 199, 128, 11]); data.set(authority.toBytes(), 8); data.set(options.accountHash, 72);
      return { owner: PROGRAM_ID, data };
    }),
  } as any;
}

describe("live demo evidence", () => {
  it("does not promote a malformed or copied report to evidence", async () => {
    expect((await verifyActivityReport(connection(), report({ signature: undefined }))).kind).toBe("unverified");
    expect((await verifyActivityReport(connection(), report({ amount: "999" }))).kind).toBe("unverified");
  });

  it("verifies a confirmed program rejection only when instruction and report agree", async () => {
    const result = await verifyActivityReport(connection(), report());
    expect(result).toMatchObject({ kind: "verified", errorCode: "PULSO_006_INTENT_MISMATCH", amount: "150", recipient: recipient.toBase58() });
    expect(result.kind === "verified" && matchCachedReport(report({ amount: "151" }), result).kind).toBe("unverified");
    expect(result.kind === "verified" && matchCachedReport(report({ policy: findPolicyPda(authority, key()).toBase58() }), result).kind).toBe("unverified");
    expect((await verifyActivityReport(connection({ code: "PULSO_005_INTENT_ALREADY_USED" }), report())).kind).toBe("unverified");
    expect((await verifyActivityReport(connection({ failIndex: 1 }), report())).kind).toBe("unverified");
  });

  it("rejects program mismatches and malformed confirmed records", async () => {
    expect((await verifyActivityReport(connection({ program: key() }), report({ programId: PROGRAM_ID.toBase58() }))).kind).toBe("unverified");
    const malformed = connection() as any;
    malformed.getTransaction = vi.fn(async () => ({ transaction: { message: {} }, meta: null }));
    expect((await verifyActivityReport(malformed, report())).kind).toBe("unverified");
  });

  it("keeps RPC failures unverified and avoids leaking custom RPC credentials in links", async () => {
    const unavailable = connection() as any;
    unavailable.getTransaction = vi.fn(async () => { throw new Error("offline"); });
    expect((await verifyActivityReport(unavailable, report())).kind).toBe("unverified");
    expect(explorerUrl(sig, "https://rpc.example/?api-key=secret")).toBeNull();
    expect(explorerUrl(sig, "http://localhost:8899")).toContain("cluster=custom&customUrl=");
  });

  it("checks reported action hash against the transaction intent account", async () => {
    const hash = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
    const hex = Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
    expect((await verifyActivityReport(connection({ accountHash: hash }), report({ actionHash: hex }))).kind).toBe("verified");
    expect((await verifyActivityReport(connection({ accountHash: hash }), report({ actionHash: "00".repeat(32) }))).kind).toBe("unverified");
  });
});
