import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { validatePolicyForm, type PolicyForm } from "../lib/policy";

const base = (): PolicyForm => ({
  agent: Keypair.generate().publicKey.toBase58(),
  mint: Keypair.generate().publicKey.toBase58(),
  autonomous: "5",
  cap: "20",
  daily: "50",
  requireNewRecipient: true,
});

describe("validatePolicyForm", () => {
  it("accepts a valid form and converts units", () => {
    const r = validatePolicyForm(base());
    if (!("value" in r)) throw new Error(r.error);
    expect(r.value.requireApprovalAbove).toBe(5_000_000n);
    expect(r.value.maxPerTransaction).toBe(20_000_000n);
    expect(r.value.dailyLimit).toBe(50_000_000n);
  });
  it("accepts equal limits", () => {
    expect("value" in validatePolicyForm({ ...base(), autonomous: "5", cap: "5", daily: "5" })).toBe(true);
  });
  it("names the violated rule", () => {
    const a = validatePolicyForm({ ...base(), autonomous: "30" });
    expect("error" in a && a.error).toMatch(/autonomous limit must be at most the per-transaction cap/);
    const b = validatePolicyForm({ ...base(), daily: "10" });
    expect("error" in b && b.error).toMatch(/per-transaction cap must be at most the daily limit/);
  });
  it("rejects bad keys and amounts", () => {
    expect("error" in validatePolicyForm({ ...base(), agent: "nope" })).toBe(true);
    expect("error" in validatePolicyForm({ ...base(), mint: "" })).toBe(true);
    expect("error" in validatePolicyForm({ ...base(), cap: "-1" })).toBe(true);
  });
});
