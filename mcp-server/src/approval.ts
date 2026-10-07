import { PublicKey } from "@solana/web3.js";
import { findIntentPda, getProgram, PROGRAM_ID, type PendingApproval } from "@pulso/sdk";
import type { Config } from "./config.js";
import { loadRecord, type StoredApproval } from "./store.js";
import { clientFor, policyContext, strictClock, ToolFailure, verifyGenesis } from "./transfer.js";

type ApprovalStatus = "pending" | "approved" | "denied" | "expired" | "used" | "revoked";
type IntentAccount = {
  authority: PublicKey; agent: PublicKey; actionHash: number[];
  issuedAt: { toString(): string }; expiresAt: { toString(): string };
  maxUses: number; usedCount: number; revoked: boolean;
};

async function backendDenial(config: Config, approvalId: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${config.approvalsUrl}/api/approvals/${approvalId}`, { signal: controller.signal });
    if (!response.ok) throw new Error("backend unavailable");
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("status" in data) ||
      typeof data.status !== "string" || !["pending", "approved", "denied"].includes(data.status)) {
      throw new Error("invalid backend status");
    }
    return data.status === "denied";
  } catch {
    throw new ToolFailure("BACKEND_UNAVAILABLE", "Approval backend unavailable; verify the request on-chain and in local state");
  } finally { clearTimeout(timer); }
}

async function chainStatus(config: Config, record: StoredApproval, pending: PendingApproval): Promise<ApprovalStatus> {
  await verifyGenesis(config);
  const now = await strictClock(config.connection);
  if (BigInt(record.requestedAt) > now) {
    throw new ToolFailure("APPROVAL_CONTEXT_MISMATCH", "Request timestamp is after the on-chain clock; check the local record and chain context");
  }
  const client = clientFor(config, { value: false });
  const policy = await policyContext(config, client); // Also validates program-owned policy and vault mint/authority.
  const intentPda = findIntentPda(config.authority, pending.intent.actionHash, PROGRAM_ID);
  let info;
  try { info = await config.connection.getAccountInfo(intentPda); }
  catch { throw new ToolFailure("RPC_UNAVAILABLE", "Chain intent lookup unavailable"); }
  if (!info) {
    if (policy.agentRevoked || !policy.enabled) return "revoked";
    if (now > BigInt(record.expiresAt)) return "expired";
    return await backendDenial(config, record.approvalId) ? "denied" : "pending";
  }
  if (!info.owner.equals(PROGRAM_ID)) throw new ToolFailure("INTENT_MISMATCH", "Intent is not owned by the PULSO program");
  let intent: IntentAccount;
  try { intent = getProgram(config.connection).coder.accounts.decode("intentAuthorization", info.data) as IntentAccount; }
  catch { throw new ToolFailure("INTENT_MISMATCH", "Intent account is invalid"); }
  if (!intent.authority.equals(config.authority) || !intent.agent.equals(config.agent.publicKey) ||
    Buffer.from(intent.actionHash).toString("hex") !== record.actionHash ||
    BigInt(intent.expiresAt.toString()) !== BigInt(record.expiresAt) || intent.maxUses !== 1 ||
    !Number.isInteger(intent.usedCount) || intent.usedCount < 0 || intent.usedCount > 1 ||
    BigInt(intent.issuedAt.toString()) <= 0n || BigInt(intent.issuedAt.toString()) < BigInt(record.requestedAt) ||
    BigInt(intent.issuedAt.toString()) > now || BigInt(intent.issuedAt.toString()) > BigInt(record.expiresAt)) {
    throw new ToolFailure("INTENT_MISMATCH", "On-chain intent differs from the exact local request");
  }
  if (intent.revoked || policy.agentRevoked || !policy.enabled) return "revoked";
  if (intent.usedCount >= intent.maxUses) return "used";
  if (now > BigInt(record.expiresAt)) return "expired";
  return "approved";
}

export async function getApprovalStatus(config: Config, approvalId: string) {
  const { record, pending } = await loadRecord(config, approvalId);
  return { status: await chainStatus(config, record, pending), approvalId };
}

export async function executeApproved(config: Config, approvalId: string) {
  const { record, pending } = await loadRecord(config, approvalId);
  const status = await chainStatus(config, record, pending);
  if (status !== "approved") {
    const codes = { pending: "APPROVAL_NOT_ON_CHAIN", denied: "APPROVAL_DENIED", expired: "INTENT_EXPIRED",
      used: "INTENT_ALREADY_USED", revoked: "INTENT_REVOKED" } as const;
    throw new ToolFailure(codes[status], `Approval is ${status}; verify the intent on-chain before retrying`);
  }
  // A retry after an ambiguous send must re-read the consumed intent, never create a new transfer.
  // The program repeats this check and consumes one use atomically with the token transfer.
  return clientFor(config, { value: false }).executeApproved(pending);
}
