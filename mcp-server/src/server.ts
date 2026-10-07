import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { Config } from "./config.js";
import { executeApproved, getApprovalStatus } from "./approval.js";
import { getPolicy, payReceiptChallenge, requestTransfer, toolError, toolSuccess } from "./transfer.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().min(32).max(44);
const decimal = z.string().regex(/^[1-9][0-9]{0,19}$/);
const nonnegativeDecimal = z.string().regex(/^(0|[1-9][0-9]*)$/);
const empty = z.strictObject({});
const approvalId = z.strictObject({ approvalId: hash });
const pendingOutput = z.strictObject({
  status: z.literal("pending"), approvalId: hash, approvalUrl: z.url(),
  reason: z.enum(["HUMAN_INTENT_REQUIRED", "RECIPIENT_NOT_ALLOWED"]),
  payload: z.strictObject({
    programId: address, policy: address, authority: address, agent: address, mint: address,
    recipientTokenAccount: address, amount: decimal, nonce: z.string().regex(/^[0-9a-f]{32}$/),
    expiresAt: z.string().regex(/^[0-9]+$/), maxUses: z.literal(1), actionHash: hash,
  }),
});

export function createServer(config: Config): McpServer {
  const server = new McpServer({ name: "pulso", version: "0.0.0" });

  server.registerTool("get_policy", {
    description: "Read the configured PULSO agent policy on-chain. No model-controlled identity overrides.",
    inputSchema: empty,
    outputSchema: z.strictObject({
      status: z.literal("found"), policy: address, authority: address, agent: address, mint: address,
      enabled: z.boolean(), agentRevoked: z.boolean(), maxPerTransaction: nonnegativeDecimal,
      dailyLimit: nonnegativeDecimal, requireApprovalAbove: nonnegativeDecimal, requireApprovalForNewRecipient: z.boolean(),
    }),
  }, async () => {
    try { return toolSuccess(await getPolicy(config)); }
    catch (error) { return toolError(error); }
  });

  server.registerTool("request_transfer", {
    description: "Request transfer from the PULSO vault to an SPL token account, not a wallet address.",
    inputSchema: z.strictObject({ amount: decimal, recipientTokenAccount: address }),
    outputSchema: z.union([
      z.strictObject({ status: z.literal("executed"), signature: z.string() }),
      pendingOutput,
    ]),
  }, async (input) => {
    try { return toolSuccess(await requestTransfer(config, input)); }
    catch (error) { return toolError(error); }
  });

  server.registerTool("pay_receipt_challenge", {
    description: "Pay a pulso-receipt-v1 402 challenge the client already read, exactly minAmount to its recipient token account. " +
      "This tool does not fetch or interpret the resource and does not choose what or how much to pay. " +
      "If executed, re-present the signature to the receiver with headers X-PULSO-Receipt: <signature> and X-PULSO-Challenge: <challengeNonce>. " +
      "If pending, a human must approve on-chain, then resume only with execute_approved; pending does not authorize any other tool or path, and a pending approval never outlives the challenge expiresAt. " +
      "An expired challenge cannot be paid: ask the receiver for a new one.",
    inputSchema: z.strictObject({
      scheme: z.literal("pulso-receipt-v1"), cluster: z.string().optional(), programId: address, recipient: address,
      mint: address, minAmount: decimal, nonce: z.string().regex(/^[0-9a-f]{32}$/), expiresAt: z.number().int().positive(),
    }),
    outputSchema: z.union([
      z.strictObject({ status: z.literal("executed"), signature: z.string(), challengeNonce: z.string().regex(/^[0-9a-f]{32}$/) }),
      pendingOutput,
    ]),
  }, async (input) => {
    try { return toolSuccess(await payReceiptChallenge(config, input)); }
    catch (error) { return toolError(error); }
  });

  server.registerTool("get_approval_status", {
    description: "Read approval status; only a valid on-chain intent proves approval.",
    inputSchema: approvalId,
    outputSchema: z.strictObject({
      status: z.enum(["pending", "approved", "denied", "expired", "used", "revoked"]), approvalId: hash,
    }),
  }, async (input) => {
    try { return toolSuccess(await getApprovalStatus(config, input.approvalId)); }
    catch (error) { return toolError(error); }
  });

  server.registerTool("execute_approved", {
    description: "Execute only the exact, locally preserved and human-authorized PULSO intent.",
    inputSchema: approvalId,
    outputSchema: z.strictObject({ status: z.literal("executed"), signature: z.string() }),
  }, async (input) => {
    try { return toolSuccess(await executeApproved(config, input.approvalId)); }
    catch (error) { return toolError(error); }
  });

  return server;
}
