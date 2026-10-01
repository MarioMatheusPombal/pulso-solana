import { PublicKey } from "@solana/web3.js";
import type { ExecuteParams, PendingApproval, PulsoClient, WaitOptions } from "./client.js";

export interface PulsoTransferToolInput {
  /** Decimal string avoids JSON number precision loss for token amounts. */
  amount: string;
  /** Destination SPL token account in base58. */
  recipient: string;
}

export type PulsoGateResult =
  | { status: "executed"; signature: string }
  | {
      status: "human_intent_required";
      reason: PendingApproval["reason"];
      approvalId: string;
      approvalUrl: string | undefined;
      intent: {
        programId: string;
        authority: string;
        agent: string;
        mint: string;
        amount: string;
        recipient: string;
        maxUses: number;
        nonce: string;
        expiresAt: string;
        actionHash: string;
      };
    };

export interface PulsoTransferGateOptions {
  /** Wait for the human, then execute the exact pending intent. Defaults to returning the pending result. */
  waitForApproval?: boolean;
  wait?: WaitOptions;
}

/** Framework-neutral tool handler. It never invokes a caller-provided financial callback. */
export function createPulsoTransferGate(client: PulsoClient, options: PulsoTransferGateOptions = {}) {
  return async (input: PulsoTransferToolInput): Promise<PulsoGateResult> => {
    if (typeof input.amount !== "string" || !/^(0|[1-9][0-9]*)$/.test(input.amount)) {
      throw new TypeError("amount must be a non-negative decimal string");
    }
    const params: ExecuteParams = { amount: BigInt(input.amount), recipient: new PublicKey(input.recipient) };
    const result = await client.execute(params);
    if (result.status === "executed") return result;
    if (options.waitForApproval) {
      await client.waitForApproval(result, options.wait);
      return client.executeApproved(result);
    }

    const f = result.intent.fields;
    return {
      status: "human_intent_required",
      reason: result.reason,
      approvalId: result.approvalId,
      approvalUrl: result.approvalUrl,
      intent: {
        programId: f.programId.toBase58(),
        authority: f.authority.toBase58(),
        agent: f.agent.toBase58(),
        mint: f.mint.toBase58(),
        amount: f.amount.toString(),
        recipient: f.recipient.toBase58(),
        maxUses: f.maxUses,
        nonce: Buffer.from(f.nonce).toString("hex"),
        expiresAt: f.expiresAt.toString(),
        actionHash: Buffer.from(result.intent.actionHash).toString("hex"),
      },
    };
  };
}
