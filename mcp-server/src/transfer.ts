import { unpackAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey, SYSVAR_CLOCK_PUBKEY } from "@solana/web3.js";
import { getProgram, PROGRAM_ID, PulsoClient, PulsoProgramError, type PulsoPolicy } from "@pulso/sdk";
import type { Config } from "./config.js";
import { makeRecord, saveRecord, StateError } from "./store.js";

const SYSVAR_OWNER = new PublicKey("Sysvar1111111111111111111111111111111111111");
const U64_MAX = (1n << 64n) - 1n;
const AMOUNT = /^[1-9][0-9]{0,19}$/;

export class ToolFailure extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}

export function toolError(error: unknown) {
  let failure: ToolFailure;
  if (error instanceof ToolFailure) failure = error;
  else if (error instanceof StateError) failure = new ToolFailure(error.code, "Check the local approval record and chain context with the operator; do not reconstruct the request from the backend");
  else if (error instanceof PulsoProgramError) failure = new ToolFailure(error.error.spec ? error.error.message : error.error.name === "IntentRevoked" ? "INTENT_REVOKED" : "RPC_UNAVAILABLE", error.error.spec ? error.error.message : "Transfer rejected by the program");
  else failure = new ToolFailure("RPC_UNAVAILABLE", "Chain request failed");
  return { isError: true as const, content: [{ type: "text" as const, text: JSON.stringify({ code: failure.code, message: failure.message }) }] };
}

export function toolSuccess<T extends object>(value: T) {
  return { structuredContent: value, content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

export async function verifyGenesis(config: Config): Promise<void> {
  let genesis: string;
  try { genesis = await config.connection.getGenesisHash(); }
  catch { throw new ToolFailure("RPC_UNAVAILABLE", "Chain connection unavailable"); }
  if (genesis !== config.genesisHash) throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Chain context changed");
}

export async function strictClock(connection: Connection): Promise<bigint> {
  let info;
  try { info = await connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY); }
  catch { throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable"); }
  if (!info || !info.owner.equals(SYSVAR_OWNER) || info.data.length < 40) {
    throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable");
  }
  const now = Buffer.from(info.data).readBigInt64LE(32);
  if (now <= 0n) throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable");
  return now;
}

function canonicalAddress(value: string): PublicKey {
  try {
    const key = new PublicKey(value);
    if (key.toBase58() !== value) throw new Error("not canonical");
    return key;
  } catch { throw new ToolFailure("RECIPIENT_INVALID", "Recipient must be a canonical SPL token account address"); }
}

async function tokenAccount(config: Config, address: PublicKey, role: "vault" | "recipient") {
  let info;
  try { info = await config.connection.getAccountInfo(address); }
  catch { throw new ToolFailure("RPC_UNAVAILABLE", "Chain connection unavailable"); }
  const invalid = role === "recipient" ? "RECIPIENT_INVALID" : "APPROVAL_CONTEXT_MISMATCH";
  if (!info || !info.owner.equals(TOKEN_PROGRAM_ID)) throw new ToolFailure(invalid, `${role} is not an SPL token account`);
  try {
    const token = unpackAccount(address, info, TOKEN_PROGRAM_ID);
    if (!token.mint.equals(config.mint)) throw new ToolFailure(invalid, `${role} mint differs from configured vault`);
    return token;
  } catch (error) {
    if (error instanceof ToolFailure) throw error;
    throw new ToolFailure(invalid, `${role} is not a valid SPL token account`);
  }
}

export async function policyContext(config: Config, client: PulsoClient): Promise<PulsoPolicy> {
  let info;
  try { info = await config.connection.getAccountInfo(client.policy); }
  catch { throw new ToolFailure("RPC_UNAVAILABLE", "Chain connection unavailable"); }
  if (!info) throw new ToolFailure("POLICY_NOT_FOUND", "Configured policy not found");
  if (!info.owner.equals(PROGRAM_ID)) throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Policy owner differs from PULSO program");
  let policy: PulsoPolicy;
  try { policy = getProgram(config.connection).coder.accounts.decode("agentPolicy", info.data) as PulsoPolicy; }
  catch { throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Configured policy is invalid"); }
  if (!policy.human.equals(config.authority) || !policy.agent.equals(config.agent.publicKey)) {
    throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Policy identity differs from operator configuration");
  }
  const vault = await tokenAccount(config, client.vault, "vault");
  if (!vault.owner.equals(client.policy)) throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Vault authority differs from policy");
  return policy;
}

export function clientFor(config: Config, clockFailed: { value: boolean }): PulsoClient {
  const guarded = new Proxy(config.connection, {
    get(target, property) {
      if (property === "getSlot") return async () => {
        try { return await target.getSlot(); }
        catch { clockFailed.value = true; throw new Error("chain clock unavailable"); }
      };
      if (property === "getBlockTime") return async () => {
        try { return Number(await strictClock(target)); }
        catch { clockFailed.value = true; throw new Error("chain clock unavailable"); }
      };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const boundedFetch: typeof fetch = async (input, init) => {
    if (clockFailed.value) throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (!response.ok) throw new ToolFailure("BACKEND_UNAVAILABLE", "Approval backend rejected the request");
      return response;
    } catch {
      throw new ToolFailure("BACKEND_UNAVAILABLE", "Approval backend unavailable");
    } finally { clearTimeout(timer); }
  };
  return new PulsoClient({ connection: guarded, agent: config.agent, human: config.authority,
    programId: PROGRAM_ID, approvalsUrl: config.approvalsUrl, fetch: boundedFetch });
}

export async function getPolicy(config: Config) {
  await verifyGenesis(config);
  const client = clientFor(config, { value: false });
  const policy = await policyContext(config, client);
  return {
    status: "found" as const, policy: client.policy.toBase58(), authority: config.authority.toBase58(),
    agent: config.agent.publicKey.toBase58(), mint: config.mint.toBase58(), enabled: policy.enabled,
    agentRevoked: policy.agentRevoked, maxPerTransaction: policy.maxPerTransaction.toString(),
    dailyLimit: policy.dailyLimit.toString(), requireApprovalAbove: policy.requireApprovalAbove.toString(),
    requireApprovalForNewRecipient: policy.requireApprovalForNewRecipient,
  };
}

export async function requestTransfer(config: Config, input: { amount: string; recipientTokenAccount: string },
  nonce?: Uint8Array, maxLifetimeSeconds?: number) {
  if (!AMOUNT.test(input.amount)) throw new ToolFailure("INVALID_ARGUMENT", "Amount must be a positive u64 decimal string");
  const amount = BigInt(input.amount);
  if (amount > U64_MAX) throw new ToolFailure("INVALID_ARGUMENT", "Amount exceeds u64");
  const recipient = canonicalAddress(input.recipientTokenAccount);
  await verifyGenesis(config);
  const clockFailed = { value: false };
  const client = clientFor(config, clockFailed);
  const policy = await policyContext(config, client);
  if (!policy.enabled) throw new ToolFailure("POLICY_DISABLED", "Configured policy is disabled");
  if (policy.agentRevoked) throw new ToolFailure("AGENT_REVOKED", "Configured agent is revoked");
  await tokenAccount(config, recipient, "recipient");
  const requestedAt = await strictClock(config.connection);
  let result;
  try {
    result = await client.execute({ amount, recipient, expiresInSeconds: Math.min(config.requestLifetimeSeconds, maxLifetimeSeconds ?? Infinity), maxUses: 1, nonce });
  } catch (error) {
    if (clockFailed.value) throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable");
    throw error;
  }
  if (clockFailed.value) throw new ToolFailure("RPC_UNAVAILABLE", "Chain clock unavailable");
  if (result.status === "executed") return { status: "executed" as const, signature: result.signature };
  await verifyGenesis(config);
  await strictClock(config.connection);
  if (!result.approvalUrl) throw new ToolFailure("BACKEND_UNAVAILABLE", "Approval URL unavailable");
  const record = makeRecord(config, result, requestedAt);
  await saveRecord(config, record);
  return {
    status: "pending" as const, approvalId: result.approvalId, approvalUrl: result.approvalUrl,
    reason: result.reason,
    payload: {
      programId: record.programId, policy: record.policy, authority: record.authority, agent: record.agent,
      mint: record.mint, recipientTokenAccount: record.recipientTokenAccount, amount: record.amount,
      nonce: record.nonce, expiresAt: record.expiresAt, maxUses: 1 as const, actionHash: record.actionHash,
    },
  };
}

const NONCE = /^[0-9a-f]{32}$/;

export interface ReceiptChallengeInput {
  scheme: string; programId: string; recipient: string; mint: string;
  minAmount: string; nonce: string; expiresAt: number; cluster?: string;
}

/** Pays exactly what the challenge asks, by the same path as request_transfer. Never fetches or reads the resource. */
export async function payReceiptChallenge(config: Config, input: ReceiptChallengeInput) {
  if (input.scheme !== "pulso-receipt-v1") throw new ToolFailure("CHALLENGE_INVALID", "Unsupported challenge scheme");
  if (!NONCE.test(input.nonce)) throw new ToolFailure("CHALLENGE_INVALID", "Challenge nonce must be 32 lowercase hex characters");
  if (!AMOUNT.test(input.minAmount) || BigInt(input.minAmount) > U64_MAX) {
    throw new ToolFailure("CHALLENGE_INVALID", "Challenge minAmount must be a positive u64 decimal string");
  }
  if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= 0) throw new ToolFailure("CHALLENGE_INVALID", "Challenge expiresAt must be Unix seconds");
  if (input.programId !== PROGRAM_ID.toBase58()) throw new ToolFailure("CHALLENGE_CONTEXT_MISMATCH", "Challenge program differs from configured PULSO program");
  if (input.mint !== config.mint.toBase58()) throw new ToolFailure("CHALLENGE_CONTEXT_MISMATCH", "Challenge mint differs from configured vault mint");
  await verifyGenesis(config);
  // The approval must expire on-chain before the challenge; 5 s cover the gap between two clock reads.
  const remaining = input.expiresAt - Number(await strictClock(config.connection));
  if (remaining - 5 < 1) throw new ToolFailure("CHALLENGE_EXPIRED", "Challenge expired or too close to expiry; ask the receiver for a new one");
  const result = await requestTransfer(config, { amount: input.minAmount, recipientTokenAccount: input.recipient },
    Uint8Array.from(Buffer.from(input.nonce, "hex")), remaining - 5);
  return result.status === "executed" ? { ...result, challengeNonce: input.nonce } : result;
}
