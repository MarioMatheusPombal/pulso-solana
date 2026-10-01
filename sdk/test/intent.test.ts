import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  buildIntent,
  computeActionHash,
  generateNonce,
  type ActionFields,
} from "../src/index.js";

const vectors = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../tests/vectors/action_hash.json", import.meta.url)), "utf8"),
).vectors as any[];

const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");
const fromHex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));

const toFields = (v: any): ActionFields => ({
  programId: new PublicKey(v.program_id),
  instruction: v.instruction,
  authority: new PublicKey(v.authority),
  agent: new PublicKey(v.agent),
  mint: new PublicKey(v.mint),
  amount: BigInt(v.amount),
  recipient: new PublicKey(v.recipient),
  maxUses: v.max_uses,
  nonce: fromHex(v.nonce),
  expiresAt: BigInt(v.expires_at),
});

describe("computeActionHash", () => {
  it.each(vectors.map((v) => [v.name, v]))("matches shared vector %s", (_n, v) => {
    expect(hex(computeActionHash(toFields(v)))).toBe(v.hash);
  });

  it("changes when any field changes", () => {
    const base = toFields(vectors[0]);
    const other = new PublicKey(vectors[0].mint);
    const alt = new PublicKey(vectors[0].authority);
    const variants: Partial<ActionFields>[] = [
      { programId: alt },
      { instruction: 2 },
      { authority: other },
      { agent: other },
      { mint: alt },
      { amount: base.amount + 1n },
      { recipient: alt },
      { maxUses: base.maxUses + 1 },
      { nonce: fromHex("ff".repeat(16)) },
      { expiresAt: base.expiresAt + 1n },
    ];
    const h = hex(computeActionHash(base));
    for (const v of variants) {
      expect(hex(computeActionHash({ ...base, ...v }))).not.toBe(h);
    }
  });

  it("rejects out-of-range values", () => {
    const base = toFields(vectors[0]);
    expect(() => computeActionHash({ ...base, nonce: new Uint8Array(15) })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, nonce: new Uint8Array(17) })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, maxUses: 65536 })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, maxUses: -1 })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, amount: 1n << 64n })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, amount: -1n })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, expiresAt: 1n << 63n })).toThrow(RangeError);
    expect(() => computeActionHash({ ...base, expiresAt: -(1n << 63n) - 1n })).toThrow(RangeError);
  });
});

describe("generateNonce", () => {
  it("returns 16 distinct random bytes", () => {
    const a = generateNonce();
    expect(a).toHaveLength(16);
    expect(hex(a)).not.toBe(hex(generateNonce()));
  });
});

describe("buildIntent", () => {
  it("defaults to execute_transfer, maxUses 1, fresh nonce", () => {
    const f = toFields(vectors[0]);
    const mk = () =>
      buildIntent({
        programId: f.programId,
        authority: f.authority,
        agent: f.agent,
        mint: f.mint,
        amount: f.amount,
        recipient: f.recipient,
        expiresAt: f.expiresAt,
      });
    const a = mk();
    expect(a.fields.instruction).toBe(1);
    expect(a.fields.maxUses).toBe(1);
    expect(a.nonce).toHaveLength(16);
    expect(hex(a.actionHash)).toBe(hex(computeActionHash(a.fields)));
    expect(hex(mk().actionHash)).not.toBe(hex(a.actionHash));
  });

  it("reproduces the vector hash with an explicit nonce", () => {
    const f = toFields(vectors[0]);
    const i = buildIntent({ ...f, nonce: f.nonce });
    expect(hex(i.actionHash)).toBe(vectors[0].hash);
  });
});
