import type { Connection, PublicKey as PublicKeyType } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { computeActionHash, generateNonce, INSTRUCTION_EXECUTE_TRANSFER } from "./intent.js";
import { findIntentPda, findPolicyPda, findVaultPda, PROGRAM_ID } from "./pda.js";

// Authority receipt v1. Spec: docs/AUTHORITY_RECEIPT_SPEC.md. Read only, fails closed:
// every step below either passes or ends the check with its own refusal reason.

export type ReceiptRefusal =
  | "RPC_ERROR"
  | "TX_NOT_FOUND"
  | "TX_FAILED"
  | "NOT_PULSO_TRANSFER"
  | "NONCE_MISMATCH"
  | "RECIPIENT_MISMATCH"
  | "MINT_MISMATCH"
  | "AMOUNT_TOO_LOW"
  | "BALANCE_MISMATCH"
  | "POLICY_INVALID"
  | "AUTHORITY_NOT_ACCEPTED"
  | "APPROVAL_REQUIRED"
  | "INTENT_INVALID"
  | "HASH_MISMATCH"
  | "CHALLENGE_UNKNOWN"
  | "CHALLENGE_CONSUMED"
  | "CHALLENGE_EXPIRED";

/** Plain JSON-serializable. Keys base58, nonce and hashes lowercase hex, u64 as decimal string. */
export interface AuthorityReceipt {
  signature: string;
  cluster: string;
  commitment: "confirmed" | "finalized";
  slot: number;
  blockTime: number | null;
  programId: string;
  policy: string;
  human: string;
  agent: string;
  vault: string;
  mint: string;
  /** Mint decimals, display only. Not part of the action hash. */
  decimals: number;
  /** Destination token account, not its owner. */
  recipient: string;
  amount: string;
  nonce: string;
  mode: "autonomous" | "approved";
  /** Approved mode only. */
  intent?: string;
  actionHash?: string;
  hashVerified?: boolean;
}

export type ReceiptResult =
  | { ok: true; receipt: AuthorityReceipt }
  | { ok: false; reason: ReceiptRefusal; detail?: string };

export interface ExpectedPayment {
  /** Destination token account. */
  recipient: PublicKeyType;
  mint: PublicKeyType;
  minAmount: bigint;
  /** 16 bytes. */
  nonce: Uint8Array;
  /** If set, `policy.human` must be in the list. */
  acceptedAuthorities?: PublicKeyType[];
  requireApproved?: boolean;
}

export interface VerifyOptions {
  programId?: PublicKeyType;
  /** `processed` is not an option. */
  commitment?: "confirmed" | "finalized";
  /** Informational, copied into the receipt. */
  cluster?: string;
}

export type ReceiptConnection = Pick<Connection, "getTransaction" | "getAccountInfo">;

const TOKEN_PROGRAM = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const EXECUTE_TRANSFER_DISC = [233, 126, 160, 184, 235, 206, 31, 119];
const POLICY_DISC = [148, 193, 218, 129, 21, 96, 195, 77];
const INTENT_DISC = [150, 220, 148, 182, 20, 199, 128, 11];
const IX_LEN = 32;
const POLICY_LEN = 120;
const INTENT_LEN = 126;
const BASE58_SIG = /^[1-9A-HJ-NP-Za-km-z]{86,88}$/;

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const startsWith = (data: Uint8Array, prefix: number[]) => prefix.every((b, i) => data[i] === b);
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((x, i) => x === b[i]);
const refuse = (reason: ReceiptRefusal, detail?: string): ReceiptResult => ({ ok: false, reason, detail });

/** Checks that `signature` is a PULSO `execute_transfer` that satisfies `expected`. Never throws for an expected failure. */
export async function verifyAuthorityReceipt(
  connection: ReceiptConnection,
  signature: string,
  expected: ExpectedPayment,
  opts: VerifyOptions = {},
): Promise<ReceiptResult> {
  const programId = opts.programId ?? PROGRAM_ID;
  const commitment = opts.commitment ?? "confirmed";
  if (commitment !== "confirmed" && commitment !== "finalized") {
    throw new RangeError(`commitment must be confirmed or finalized, got ${String(commitment)}`);
  }
  if (expected.recipient === undefined || expected.mint === undefined || expected.minAmount === undefined || expected.nonce === undefined) {
    return refuse("RPC_ERROR", "expected challenge is incomplete");
  }
  try {
    return await verify(connection, signature, expected, programId, commitment, opts.cluster ?? "unknown");
  } catch (e) {
    // Anything unexpected (malformed response included) refuses; it never becomes a receipt.
    return refuse("RPC_ERROR", e instanceof Error ? e.message : String(e));
  }
}

/**
 * Same checks as `verifyAuthorityReceipt`, without a receiver challenge. With no nonce the transaction must
 * hold exactly one candidate `execute_transfer`; recipient, mint and amount come from the transaction itself.
 * Proves the authority, not that this payment answers a specific request.
 */
export async function describeAuthorityReceipt(
  connection: ReceiptConnection,
  signature: string,
  opts: VerifyOptions = {},
): Promise<ReceiptResult> {
  const programId = opts.programId ?? PROGRAM_ID;
  const commitment = opts.commitment ?? "confirmed";
  if (commitment !== "confirmed" && commitment !== "finalized") {
    throw new RangeError(`commitment must be confirmed or finalized, got ${String(commitment)}`);
  }
  try {
    return await verify(connection, signature, {}, programId, commitment, opts.cluster ?? "unknown");
  } catch (e) {
    return refuse("RPC_ERROR", e instanceof Error ? e.message : String(e));
  }
}

async function verify(
  connection: ReceiptConnection,
  signature: string,
  expected: Partial<ExpectedPayment>,
  programId: PublicKeyType,
  commitment: "confirmed" | "finalized",
  cluster: string,
): Promise<ReceiptResult> {
  // 2 (shape only). A malformed signature cannot exist on chain.
  if (!BASE58_SIG.test(signature)) return refuse("TX_NOT_FOUND", "signature is not base58 of 64 bytes");

  // 1
  let tx;
  try {
    tx = await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
  } catch (e) {
    return refuse("RPC_ERROR", e instanceof Error ? e.message : String(e));
  }
  // 2
  if (tx === null) return refuse("TX_NOT_FOUND");
  // 3
  if (!tx.meta) return refuse("RPC_ERROR", "response has no meta");
  if (tx.meta.err !== null) return refuse("TX_FAILED", JSON.stringify(tx.meta.err));

  // 4. Account keys: static, then loaded writable, then loaded readonly.
  const msg = tx.transaction.message;
  const keys: PublicKeyType[] = [
    ...msg.staticAccountKeys,
    ...(tx.meta.loadedAddresses?.writable ?? []),
    ...(tx.meta.loadedAddresses?.readonly ?? []),
  ];
  const numSigners = msg.header.numRequiredSignatures;
  const candidates = msg.compiledInstructions.filter((ix) => {
    const program = keys[ix.programIdIndex];
    return program !== undefined && program.equals(programId) && ix.data.length === IX_LEN && startsWith(ix.data, EXECUTE_TRANSFER_DISC);
  });
  if (candidates.length === 0) return refuse("NOT_PULSO_TRANSFER", "no top-level execute_transfer for this program");
  for (const ix of candidates) {
    const idx = ix.accountKeyIndexes;
    if (idx.length < 5 || idx.slice(0, 5).some((i) => keys[i] === undefined)) {
      return refuse("NOT_PULSO_TRANSFER", "execute_transfer is missing required accounts");
    }
    if (idx[0]! >= numSigners) return refuse("NOT_PULSO_TRANSFER", "account 0 is not a signer");
    if (keys[idx[4]!]!.toBase58() !== TOKEN_PROGRAM) return refuse("NOT_PULSO_TRANSFER", "account 4 is not the Token program");
  }

  // 5. Exactly one candidate with the challenge nonce. Without a challenge: exactly one candidate.
  const wanted = expected.nonce;
  let matching = candidates;
  if (wanted !== undefined) {
    if (wanted.length !== 16) return refuse("NONCE_MISMATCH", "challenge nonce must be 16 bytes");
    matching = candidates.filter((ix) => same(ix.data.subarray(16, 32), wanted));
    if (matching.length !== 1) return refuse("NONCE_MISMATCH", `${matching.length} instructions carry the challenge nonce`);
  } else if (matching.length !== 1) {
    return refuse("NONCE_MISMATCH", `${matching.length} execute_transfer instructions, cannot pick one without a challenge nonce`);
  }
  const ix = matching[0]!;
  const idx = ix.accountKeyIndexes;

  // 6
  const amount = new DataView(ix.data.buffer, ix.data.byteOffset, ix.data.byteLength).getBigUint64(8, true);
  const nonce = ix.data.slice(16, 32);
  const agentKey = keys[idx[0]!]!;
  const policy = keys[idx[1]!]!;
  const vault = keys[idx[2]!]!;
  const recipient = keys[idx[3]!]!;
  if (expected.recipient !== undefined && !recipient.equals(expected.recipient)) return refuse("RECIPIENT_MISMATCH");

  // 7
  const recipientIndex = idx[3]!;
  const post = tx.meta.postTokenBalances?.find((b) => b.accountIndex === recipientIndex);
  if (!post || (expected.mint !== undefined && post.mint !== expected.mint.toBase58())) return refuse("MINT_MISMATCH");
  const decimals = post.uiTokenAmount.decimals;
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 255) return refuse("MINT_MISMATCH", "token decimals missing from the response");
  const mint = expected.mint ?? new PublicKey(post.mint);

  // 8
  if (expected.minAmount !== undefined && amount < expected.minAmount) return refuse("AMOUNT_TOO_LOW", `paid ${amount}, wanted at least ${expected.minAmount}`);

  // 9
  const pre = tx.meta.preTokenBalances?.find((b) => b.accountIndex === recipientIndex);
  if (!pre) return refuse("BALANCE_MISMATCH", "no pre balance for recipient");
  if (BigInt(post.uiTokenAmount.amount) - BigInt(pre.uiTokenAmount.amount) < amount) {
    return refuse("BALANCE_MISMATCH", "recipient balance grew by less than amount");
  }

  // 10. minContextSlot keeps a lagging node from answering with older state.
  const read = async (key: PublicKeyType) => {
    try {
      return { info: await connection.getAccountInfo(key, { commitment, minContextSlot: tx.slot }) };
    } catch (e) {
      return { err: e instanceof Error ? e.message : String(e) };
    }
  };
  const p = await read(policy);
  if (p.err !== undefined) return refuse("RPC_ERROR", p.err);
  const pd = p.info?.data;
  if (!p.info || !p.info.owner.equals(programId) || !pd || pd.length !== POLICY_LEN || !startsWith(pd, POLICY_DISC)) {
    return refuse("POLICY_INVALID", "policy account missing, not owned by the program, or wrong layout");
  }
  const human = new PublicKey(pd.subarray(8, 40));
  const policyAgent = new PublicKey(pd.subarray(40, 72));
  if (human.equals(policyAgent)) return refuse("POLICY_INVALID", "policy human and agent are the same key");
  if (!findPolicyPda(human, policyAgent, programId).equals(policy)) return refuse("POLICY_INVALID", "policy address does not match its human and agent");
  if (!policyAgent.equals(agentKey)) return refuse("POLICY_INVALID", "policy agent is not the signer");
  if (!findVaultPda(policy, programId).equals(vault)) return refuse("POLICY_INVALID", "vault is not the policy vault");

  // 11
  if (expected.acceptedAuthorities && !expected.acceptedAuthorities.some((a) => a.equals(human))) {
    return refuse("AUTHORITY_NOT_ACCEPTED", human.toBase58());
  }

  // 12
  const intentKey = idx.length > 5 ? keys[idx[5]!] : undefined;
  if (idx.length > 5 && intentKey === undefined) return refuse("NOT_PULSO_TRANSFER", "account 5 is out of range");
  const approved = intentKey !== undefined && !intentKey.equals(programId);
  if (expected.requireApproved && !approved) return refuse("APPROVAL_REQUIRED");

  const receipt: AuthorityReceipt = {
    signature,
    cluster,
    commitment,
    slot: tx.slot,
    blockTime: tx.blockTime ?? null,
    programId: programId.toBase58(),
    policy: policy.toBase58(),
    human: human.toBase58(),
    agent: policyAgent.toBase58(),
    vault: vault.toBase58(),
    mint: mint.toBase58(),
    decimals,
    recipient: recipient.toBase58(),
    amount: amount.toString(),
    nonce: hex(nonce),
    mode: approved ? "approved" : "autonomous",
  };
  if (!approved) return { ok: true, receipt };

  // 13
  const i = await read(intentKey);
  if (i.err !== undefined) return refuse("RPC_ERROR", i.err);
  const id = i.info?.data;
  if (!i.info || !i.info.owner.equals(programId) || !id || id.length !== INTENT_LEN || !startsWith(id, INTENT_DISC)) {
    return refuse("INTENT_INVALID", "intent account missing, not owned by the program, or wrong layout");
  }
  if (!new PublicKey(id.subarray(8, 40)).equals(human) || !new PublicKey(id.subarray(40, 72)).equals(policyAgent)) {
    return refuse("INTENT_INVALID", "intent authority or agent does not match the policy");
  }

  // 14. Recompute the hash from what the transaction paid and what the intent recorded.
  const idView = new DataView(id.buffer, id.byteOffset, id.byteLength);
  const actionHash = id.slice(72, 104);
  const recomputed = computeActionHash({
    programId,
    instruction: INSTRUCTION_EXECUTE_TRANSFER,
    authority: human,
    agent: policyAgent,
    mint,
    amount,
    recipient,
    maxUses: idView.getUint16(120, true),
    nonce,
    expiresAt: idView.getBigInt64(112, true),
  });
  if (!same(recomputed, actionHash)) return refuse("HASH_MISMATCH", "recomputed action hash differs from the intent");
  if (!findIntentPda(human, actionHash, programId).equals(intentKey)) return refuse("HASH_MISMATCH", "intent address does not match its action hash");

  receipt.intent = intentKey.toBase58();
  receipt.actionHash = hex(actionHash);
  receipt.hashVerified = true;
  return { ok: true, receipt };
}

// ---- Receiver side: challenges ----

/** JSON body of the HTTP 402 response (spec section 7). */
export interface PaymentChallenge {
  scheme: "pulso-receipt-v1";
  cluster: string;
  programId: string;
  /** Destination token account. */
  recipient: string;
  mint: string;
  /** u64 as decimal string. */
  minAmount: string;
  /** 32 hex chars. */
  nonce: string;
  /** Unix seconds. */
  expiresAt: number;
}

export interface ChallengeParams {
  recipient: PublicKeyType;
  mint: PublicKeyType;
  minAmount: bigint;
  ttlSeconds: number;
  cluster?: string;
  programId?: PublicKeyType;
}

export function createPaymentChallenge(p: ChallengeParams): PaymentChallenge {
  if (p.minAmount <= 0n || p.minAmount >= 1n << 64n) throw new RangeError(`minAmount out of range: ${p.minAmount}`);
  if (!Number.isInteger(p.ttlSeconds) || p.ttlSeconds <= 0) throw new RangeError(`ttlSeconds must be a positive integer: ${p.ttlSeconds}`);
  return {
    scheme: "pulso-receipt-v1",
    cluster: p.cluster ?? "devnet",
    programId: (p.programId ?? PROGRAM_ID).toBase58(),
    recipient: p.recipient.toBase58(),
    mint: p.mint.toBase58(),
    minAmount: p.minAmount.toString(),
    nonce: hex(generateNonce()),
    expiresAt: Math.floor(Date.now() / 1000) + p.ttlSeconds,
  };
}

export interface RedeemOptions {
  commitment?: "confirmed" | "finalized";
  acceptedAuthorities?: PublicKeyType[];
  requireApproved?: boolean;
}

/**
 * In-memory, single-process challenge registry, demonstration level: lost on restart and
 * not shared between processes. Production keeps this in the receiver's own storage.
 * A challenge is spent only after a full `ok: true`; a refusal leaves it open.
 */
export class ChallengeLedger {
  private entries = new Map<string, { challenge: PaymentChallenge; state: "open" | "verifying" | "redeemed" }>();

  issue(params: ChallengeParams): PaymentChallenge {
    const challenge = createPaymentChallenge(params);
    this.entries.set(challenge.nonce, { challenge, state: "open" });
    return challenge;
  }

  async redeem(connection: ReceiptConnection, signature: string, nonceHex: string, opts: RedeemOptions = {}): Promise<ReceiptResult> {
    const entry = this.entries.get(nonceHex.toLowerCase());
    if (!entry) return refuse("CHALLENGE_UNKNOWN");
    if (entry.state !== "open") return refuse("CHALLENGE_CONSUMED");
    const c = entry.challenge;
    if (Date.now() / 1000 > c.expiresAt) return refuse("CHALLENGE_EXPIRED");

    // Claimed before the first await, so a concurrent redeem of the same nonce sees it taken.
    entry.state = "verifying";
    let result: ReceiptResult;
    try {
      result = await verifyAuthorityReceipt(
        connection,
        signature,
        {
          recipient: new PublicKey(c.recipient),
          mint: new PublicKey(c.mint),
          minAmount: BigInt(c.minAmount),
          nonce: Uint8Array.from(c.nonce.match(/../g)!, (h) => parseInt(h, 16)),
          acceptedAuthorities: opts.acceptedAuthorities,
          requireApproved: opts.requireApproved,
        },
        { programId: new PublicKey(c.programId), commitment: opts.commitment, cluster: c.cluster },
      );
    } catch (e) {
      entry.state = "open";
      throw e;
    }
    entry.state = result.ok ? "redeemed" : "open";
    return result;
  }
}
