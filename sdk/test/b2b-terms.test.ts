import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  computeActionHash,
  computeTermsDigest,
  termsPreimage,
  type B2BTerms,
} from "../src/index.js";

const file = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/vectors/b2b_terms.json", import.meta.url)), "utf8"),
);
const vectors = file.vectors as any[];

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

const toTerms = (v: any): B2BTerms => ({
  kind: v.kind,
  genesis: new PublicKey(v.genesis).toBytes(),
  programId: new PublicKey(v.program_id),
  policy: new PublicKey(v.policy),
  payerAuthority: new PublicKey(v.payer_authority),
  agent: new PublicKey(v.agent),
  mint: new PublicKey(v.mint),
  recipientTokenAccount: new PublicKey(v.recipient_token_account),
  receiverAuthority: new PublicKey(v.receiver_authority),
  amount: BigInt(v.amount),
  nonce: new Uint8Array(Buffer.from(v.nonce, "hex")),
  expiry: BigInt(v.expiry),
});

// Independent second implementation: Buffer + node:crypto, no SDK code.
const handmade = (v: any): Buffer => {
  const pk = (s: string) => Buffer.from(new PublicKey(s).toBytes());
  const u64 = Buffer.alloc(8);
  u64.writeBigUInt64LE(BigInt(v.amount));
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(BigInt(v.expiry));
  return Buffer.concat([
    Buffer.from("PULSO_B2B_TERMS_V1", "ascii"),
    Buffer.from([v.kind === "charge" ? 1 : 2]),
    pk(v.genesis),
    pk(v.program_id),
    pk(v.policy),
    pk(v.payer_authority),
    pk(v.agent),
    pk(v.mint),
    pk(v.recipient_token_account),
    pk(v.receiver_authority),
    u64,
    Buffer.from(v.nonce, "hex"),
    i64,
  ]);
};

describe("computeTermsDigest", () => {
  it("vector file declares version and length", () => {
    expect(file.version).toBe("PULSO_B2B_TERMS_V1");
    expect(file.preimage_len).toBe(307);
  });

  it.each(vectors.map((v) => [v.name, v]))("matches shared vector %s", (_n, v) => {
    const t = toTerms(v);
    const pre = termsPreimage(t);
    expect(pre).toHaveLength(307);
    expect(hex(pre)).toBe(v.preimage_hex);
    expect(hex(computeTermsDigest(t))).toBe(v.digest_hex);
    // second implementation agrees with the vector
    const hm = handmade(v);
    expect(hm.toString("hex")).toBe(v.preimage_hex);
    expect(createHash("sha256").update(hm).digest("hex")).toBe(v.digest_hex);
  });

  it("covers both kinds and amount 2^64-1", () => {
    expect(vectors.some((v) => v.kind === "charge")).toBe(true);
    expect(vectors.some((v) => v.kind === "send")).toBe(true);
    expect(vectors.some((v) => v.amount === "18446744073709551615")).toBe(true);
  });

  it("every changed-field vector differs from base and from each other", () => {
    const base = vectors.find((v) => v.name === "base_charge");
    const changed = vectors.filter((v) => v.name.endsWith("_changed"));
    expect(changed).toHaveLength(12);
    const digests = [base.digest_hex, ...changed.map((v) => v.digest_hex)];
    expect(new Set(digests).size).toBe(digests.length);
  });

  it("never equals the action hash v1 over shared fields", () => {
    for (const v of vectors) {
      const t = toTerms(v);
      const ah = computeActionHash({
        programId: t.programId,
        instruction: 1,
        authority: t.payerAuthority,
        agent: t.agent,
        mint: t.mint,
        amount: t.amount,
        recipient: t.recipientTokenAccount,
        maxUses: 1,
        nonce: t.nonce,
        expiresAt: t.expiry,
      });
      expect(hex(ah)).not.toBe(v.digest_hex);
    }
  });

  it("rejects invalid input", () => {
    const base = toTerms(vectors[0]);
    const bad = (o: Partial<B2BTerms>) => () => computeTermsDigest({ ...base, ...o });
    expect(bad({ amount: 0n })).toThrow(RangeError);
    expect(bad({ amount: -1n })).toThrow(RangeError);
    expect(bad({ amount: 1n << 64n })).toThrow(RangeError);
    expect(bad({ amount: 1 as any })).toThrow(RangeError);
    expect(bad({ nonce: new Uint8Array(15) })).toThrow(RangeError);
    expect(bad({ nonce: new Uint8Array(17) })).toThrow(RangeError);
    expect(bad({ expiry: 1n << 63n })).toThrow(RangeError);
    expect(bad({ expiry: -(1n << 63n) - 1n })).toThrow(RangeError);
    expect(bad({ expiry: 1.5 as any })).toThrow(RangeError);
    expect(bad({ kind: "refund" as any })).toThrow(RangeError);
    expect(bad({ genesis: new Uint8Array(31) })).toThrow(RangeError);
    expect(bad({ genesis: new Uint8Array(33) })).toThrow(RangeError);
  });
});
