import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// B2B terms digest `pulso-b2b-terms-v1` (solana/14_B2B_NETWORK_SPEC.md, section 5).
// Pure function, 307-byte preimage. Distinct from the action hash v1 (tag and length differ).
export const TERMS_TAG = "PULSO_B2B_TERMS_V1";

export type B2BTermsKind = "charge" | "send";

const KIND_BYTE: Record<B2BTermsKind, number> = { charge: 1, send: 2 };
const NONCE_LEN = 16;
const GENESIS_LEN = 32;
const PREIMAGE_LEN = 307;
const U64_MAX = (1n << 64n) - 1n;
const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

export interface B2BTerms {
  /** `charge` = cobranca (1), `send` = proposta de envio (2). */
  kind: B2BTermsKind;
  /** Raw 32 bytes of the cluster genesis hash (decoded base58). */
  genesis: Uint8Array;
  programId: PublicKey;
  policy: PublicKey;
  payerAuthority: PublicKey;
  agent: PublicKey;
  mint: PublicKey;
  recipientTokenAccount: PublicKey;
  receiverAuthority: PublicKey;
  /** Base units, `0 < amount < 2^64`. */
  amount: bigint;
  nonce: Uint8Array;
  /** Unix seconds, i64. */
  expiry: bigint;
}

/** The exact 307 bytes hashed by `computeTermsDigest`. */
export function termsPreimage(t: B2BTerms): Uint8Array {
  const kind = KIND_BYTE[t.kind];
  if (kind === undefined) throw new RangeError(`kind must be "charge" or "send": ${String(t.kind)}`);
  if (typeof t.amount !== "bigint" || t.amount <= 0n || t.amount > U64_MAX) {
    throw new RangeError(`amount must satisfy 0 < amount < 2^64: ${String(t.amount)}`);
  }
  if (typeof t.expiry !== "bigint" || t.expiry < I64_MIN || t.expiry > I64_MAX) {
    throw new RangeError(`expiry out of i64 range: ${String(t.expiry)}`);
  }
  if (t.nonce.length !== NONCE_LEN) {
    throw new RangeError(`nonce must be ${NONCE_LEN} bytes, got ${t.nonce.length}`);
  }
  if (t.genesis.length !== GENESIS_LEN) {
    throw new RangeError(`genesis must be ${GENESIS_LEN} bytes, got ${t.genesis.length}`);
  }

  const buf = new Uint8Array(PREIMAGE_LEN);
  const view = new DataView(buf.buffer);
  let o = 0;
  const put = (b: Uint8Array) => {
    buf.set(b, o);
    o += b.length;
  };
  put(new TextEncoder().encode(TERMS_TAG));
  buf[o++] = kind;
  put(t.genesis);
  put(t.programId.toBytes());
  put(t.policy.toBytes());
  put(t.payerAuthority.toBytes());
  put(t.agent.toBytes());
  put(t.mint.toBytes());
  put(t.recipientTokenAccount.toBytes());
  put(t.receiverAuthority.toBytes());
  view.setBigUint64(o, t.amount, true);
  o += 8;
  put(t.nonce);
  view.setBigInt64(o, t.expiry, true);
  o += 8;
  if (o !== PREIMAGE_LEN) throw new Error(`preimage length ${o}, expected ${PREIMAGE_LEN}`);
  return buf;
}

export function computeTermsDigest(t: B2BTerms): Uint8Array {
  return sha256(termsPreimage(t));
}
