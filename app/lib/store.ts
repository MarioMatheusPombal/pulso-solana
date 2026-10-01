// Approval request queue. In-memory, demo only.
//
// TRUST BOUNDARY: this module holds no keys, signs nothing and never talks to
// the chain. `status: "approved"` is only a hint telling the waiting agent to
// stop polling. The real authorization is the intent the human wrote on-chain
// with their own wallet (`record_intent`); the program rejects any execution
// without it. A compromised backend that marks a request "approved" releases
// nothing.
//
// NOT AUDITED · DEVNET DEMONSTRATION ONLY

export type ApprovalStatus = "pending" | "approved" | "denied";

export interface ApprovalRequest {
  /** Hex of actionHash: unique per action, makes POST idempotent. */
  id: string;
  programId: string;
  policy: string;
  authority: string;
  agent: string;
  mint: string;
  recipient: string;
  amount: string;
  expiresAt: string;
  maxUses: number;
  nonce: string;
  actionHash: string;
  status: ApprovalStatus;
  /** Signature of the human's record_intent tx; reference only. */
  signature?: string;
  createdAt: string;
}

export type ActivityStatus = "autonomous" | "blocked" | "approved" | "executed" | "rejected";
export type ActivityEvidence = "confirmed_transaction" | "simulation" | "chain_account_observed";

export interface ActivityEvent {
  eventId: string;
  status: ActivityStatus;
  evidence: ActivityEvidence;
  authority: string;
  agent: string;
  programId: string;
  policy: string;
  mint?: string;
  actionHash?: string;
  amount: string;
  recipient: string;
  code?: string;
  signature?: string;
  createdAt: string;
}

const g = globalThis as unknown as { __pulsoApprovals?: Map<string, ApprovalRequest> };
// Hang the Map on globalThis so it survives hot reload.
export const approvals = (g.__pulsoApprovals ??= new Map<string, ApprovalRequest>());

const activitiesGlobal = globalThis as unknown as { __pulsoActivities?: Map<string, ActivityEvent> };
export const activities = (activitiesGlobal.__pulsoActivities ??= new Map<string, ActivityEvent>());
