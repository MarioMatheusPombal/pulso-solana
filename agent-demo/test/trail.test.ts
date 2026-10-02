import { PROGRAM_ID, INSTRUCTION_EXECUTE_TRANSFER, computeActionHash } from "@pulso/sdk";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { attachApprovals, classify, formatTrail, summarize, type Entry, type RawTx, type Trail } from "../src/trail.js";

const key = (n: number) => new PublicKey(Buffer.alloc(32, n));
const [human, agent, mint, merchant, intent, policy] = [1, 2, 3, 4, 5, 6].map(key);
const nonce = Buffer.alloc(16, 7);
const expiresAt = 2_000_000_000n;
const fields = { programId: PROGRAM_ID, instruction: INSTRUCTION_EXECUTE_TRANSFER, authority: human, agent, mint, amount: 100_000_000n, recipient: merchant, maxUses: 1, nonce, expiresAt };
const actionHash = computeActionHash(fields);
const at = (n: number) => ({ slot: n, blockTime: 1_800_000_000 + n, signature: `sig${n}`.padEnd(88, "x") });
const transfer = (d: object) => ({ name: "TransferExecuted", data: { policy, agent, mint, recipient: merchant, spentInWindow: 0n, ...d } });

describe("authorization trail", () => {
  const txs: RawTx[] = [
    { ...at(1), failed: undefined, transfers: [{ amount: 5_000_000n, nonce: hex0() }], events: [transfer({ amount: 5_000_000n, intent: null })] },
    { ...at(2), failed: undefined, transfers: [{ amount: 100_000_000n, nonce: nonce.toString("hex") }], events: [transfer({ amount: 100_000_000n, intent })] },
    { ...at(3), failed: { code: 6005, text: "x" }, transfers: [{ amount: 150_000_000n, nonce: nonce.toString("hex") }], events: [] },
  ];
  const intents = new Map([[intent.toBase58(), { authority: human, actionHash, issuedAt: 1_799_999_000n, expiresAt, maxUses: 1, usedCount: 1, revoked: false }]]);

  it("classifies autonomous, approved with a verified hash, and refused", () => {
    const entries = attachApprovals(txs.flatMap(classify), intents, { human: human.toBase58(), agent: agent.toBase58() });
    expect(entries.map((e) => (e.kind === "transfer" ? e.mode : e.kind))).toEqual(["autonomous", "approved", "refused"]);
    expect((entries[1] as Extract<Entry, { kind: "transfer" }>).approval?.hash).toBe("verified");
    expect(entries[2]).toMatchObject({ error: "PULSO_006_INTENT_MISMATCH", code: 6005, amount: 150_000_000n });
    expect(summarize(entries)).toEqual({ autonomous: 1, approved: 1, hashVerified: 1, hashMismatch: 0, refused: { PULSO_006_INTENT_MISMATCH: 1 } });

    const trail: Trail = { policy: { address: policy.toBase58(), human: human.toBase58(), agent: agent.toBase58(), mint: mint.toBase58(), decimals: 6, agentRevoked: false, enabled: true, maxPerTransaction: 500_000_000n, dailyLimit: 1_000_000_000n, requireApprovalAbove: 10_000_000n, requireApprovalForNewRecipient: true, policyVersion: 1 }, entries, summary: summarize(entries) };
    const text = formatTrail(trail).join("\n");
    expect(text).toContain("transfer autonomous  5 to");
    expect(text).toContain("hash verified");
    expect(text).toContain("REFUSED  PULSO_006_INTENT_MISMATCH (6005)  attempted 150");
    expect(text.endsWith("NOT AUDITED · DEVNET DEMONSTRATION ONLY")).toBe(true);
  });

  it("shouts when the hash does not match", () => {
    const bad = new Map([[intent.toBase58(), { ...intents.get(intent.toBase58())!, expiresAt: expiresAt + 1n }]]);
    const [e] = attachApprovals(classify(txs[1]!), bad, { human: human.toBase58(), agent: agent.toBase58() });
    expect(e).toMatchObject({ approval: { hash: "MISMATCH" } });
  });
});

function hex0() {
  return "00".repeat(16);
}
