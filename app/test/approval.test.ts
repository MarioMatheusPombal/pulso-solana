import { Keypair, PublicKey } from "@solana/web3.js";
import { buildIntent, findPolicyPda, PROGRAM_ID } from "@pulso/sdk";
import { describe, expect, it } from "vitest";
import { formatCountdown, prepareApproval, secondsLeft, type ApprovalPayload } from "../lib/approval";

const k = () => Keypair.generate().publicKey;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function payload(): ApprovalPayload {
  const authority = k(), agent = k();
  const i = buildIntent({
    programId: PROGRAM_ID, authority, agent, mint: k(), amount: 100_000_000n, recipient: k(), expiresAt: 2_000_000_000n, maxUses: 1,
  });
  const f = i.fields;
  return {
    programId: f.programId.toBase58(), policy: findPolicyPda(authority, agent).toBase58(), authority: authority.toBase58(),
    agent: agent.toBase58(), mint: f.mint.toBase58(), recipient: f.recipient.toBase58(), amount: f.amount.toString(),
    expiresAt: f.expiresAt.toString(), maxUses: f.maxUses, nonce: hex(f.nonce), actionHash: hex(i.actionHash),
  };
}

describe("prepareApproval", () => {
  it("derives display and instruction args from the same fields", () => {
    const p = payload();
    const r = prepareApproval(p);
    if (!r.ok) throw new Error(r.error);
    expect(r.display.amount).toBe("100.00 USDC");
    expect(r.display.recipient).toBe(p.recipient);
    expect(hex(r.args.actionHash)).toBe(p.actionHash);
    expect(r.args.expiresAt).toBe(2_000_000_000n);
    expect(r.args.maxUses).toBe(1);
  });
  it("blocks approval when any displayed field changes", () => {
    const base = payload();
    const tampered: Partial<ApprovalPayload>[] = [
      { amount: "150000000" },
      { recipient: k().toBase58() },
      { mint: k().toBase58() },
      { agent: k().toBase58() },
      { authority: k().toBase58() },
      { expiresAt: "2000000001" },
      { maxUses: 2 },
      { nonce: "00".repeat(16) },
      { programId: k().toBase58() },
    ];
    for (const t of tampered) expect(prepareApproval({ ...base, ...t }).ok).toBe(false);
  });
  it("blocks a policy that is not the PDA of authority and agent", () => {
    expect(prepareApproval({ ...payload(), policy: k().toBase58() }).ok).toBe(false);
  });
  it("rejects malformed input without throwing", () => {
    expect(prepareApproval({ ...payload(), amount: "1.5" }).ok).toBe(false);
    expect(prepareApproval({ ...payload(), mint: "nope" }).ok).toBe(false);
  });
});

describe("countdown", () => {
  it("computes and formats", () => {
    expect(secondsLeft(1100n, 1_000_000)).toBe(100);
    expect(formatCountdown(125)).toBe("2m 05s");
    expect(formatCountdown(9)).toBe("9s");
    expect(formatCountdown(0)).toBe("expired");
    expect(formatCountdown(-5)).toBe("expired");
  });
});
