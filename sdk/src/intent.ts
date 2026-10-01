import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";

// Canonical action hash v1. Mirrors programs/pulso/src/action_hash.rs byte for byte.
export const DOMAIN = "PULSO_INTENT_V1";
export const CHAIN = "solana";
/** `instruction` value for execute_transfer. */
export const INSTRUCTION_EXECUTE_TRANSFER = 1;

const NONCE_LEN = 16;
const PREIMAGE_LEN = 216;
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export interface ActionFields {
  programId: PublicKey;
  instruction: number;
  authority: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  amount: bigint;
  /** Destination token account address. */
  recipient: PublicKey;
  maxUses: number;
  nonce: Uint8Array;
  expiresAt: bigint;
}

export interface Intent {
  fields: ActionFields;
  nonce: Uint8Array;
  actionHash: Uint8Array;
}

export function generateNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(NONCE_LEN));
}

export function computeActionHash(f: ActionFields): Uint8Array {
  if (!Number.isInteger(f.instruction) || f.instruction < 0 || f.instruction > 255) {
    throw new RangeError(`instruction out of u8 range: ${f.instruction}`);
  }
  if (!Number.isInteger(f.maxUses) || f.maxUses < 0 || f.maxUses > 0xffff) {
    throw new RangeError(`maxUses out of u16 range: ${f.maxUses}`);
  }
  if (f.amount < 0n || f.amount > U64_MAX) {
    throw new RangeError(`amount out of u64 range: ${f.amount}`);
  }
  if (f.expiresAt < I64_MIN || f.expiresAt > I64_MAX) {
    throw new RangeError(`expiresAt out of i64 range: ${f.expiresAt}`);
  }
  if (f.nonce.length !== NONCE_LEN) {
    throw new RangeError(`nonce must be ${NONCE_LEN} bytes, got ${f.nonce.length}`);
  }

  const buf = new Uint8Array(PREIMAGE_LEN);
  const view = new DataView(buf.buffer);
  const enc = new TextEncoder();
  let o = 0;
  const put = (b: Uint8Array) => {
    buf.set(b, o);
    o += b.length;
  };
  put(enc.encode(DOMAIN));
  put(enc.encode(CHAIN));
  put(f.programId.toBytes());
  buf[o++] = f.instruction;
  put(f.authority.toBytes());
  put(f.agent.toBytes());
  put(f.mint.toBytes());
  view.setBigUint64(o, f.amount, true);
  o += 8;
  put(f.recipient.toBytes());
  view.setUint16(o, f.maxUses, true);
  o += 2;
  put(f.nonce);
  view.setBigInt64(o, f.expiresAt, true);
  o += 8;
  if (o !== PREIMAGE_LEN) throw new Error(`preimage length ${o}, expected ${PREIMAGE_LEN}`);
  return sha256(buf);
}

export function buildIntent(p: {
  programId: PublicKey;
  authority: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  amount: bigint;
  recipient: PublicKey;
  expiresAt: bigint;
  maxUses?: number;
  nonce?: Uint8Array;
}): Intent {
  const nonce = p.nonce ?? generateNonce();
  const fields: ActionFields = {
    programId: p.programId,
    instruction: INSTRUCTION_EXECUTE_TRANSFER,
    authority: p.authority,
    agent: p.agent,
    mint: p.mint,
    amount: p.amount,
    recipient: p.recipient,
    maxUses: p.maxUses ?? 1,
    nonce,
    expiresAt: p.expiresAt,
  };
  return { fields, nonce, actionHash: computeActionHash(fields) };
}
