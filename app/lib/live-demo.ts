import { PublicKey, type Connection } from "@solana/web3.js";
import { findIntentPda, findPolicyPda, PROGRAM_ID } from "@pulso/sdk/src/pda.js";
import { describeAuthorityReceipt } from "@pulso/sdk/src/receipt.js";
import { describeRpc } from "./receipt";
import { RPC_URL } from "./config";
import { parseActivity } from "./activity";

export type DemoReport = {
  eventId: string; status: string; evidence: string; programId: string; policy: string;
  amount: string; recipient: string; signature?: string; actionHash?: string; code?: string; createdAt: string;
};
export type Verification =
  | { kind: "verified"; signature: string; status: string; policy: string; amount: string; recipient: string; programId: string; actionHash?: string; errorCode?: string }
  | { kind: "unverified"; reason: string };

const EXECUTE_DISCRIMINATOR = Uint8Array.from([233, 126, 160, 184, 235, 206, 31, 119]);
const ERROR_CODES: Record<string, number> = { PULSO_001_POLICY_NOT_FOUND: 6000, PULSO_002_POLICY_DISABLED: 6001, PULSO_003_HUMAN_INTENT_REQUIRED: 6002, PULSO_004_INTENT_EXPIRED: 6003, PULSO_005_INTENT_ALREADY_USED: 6004, PULSO_006_INTENT_MISMATCH: 6005, PULSO_007_RECIPIENT_NOT_ALLOWED: 6006, PULSO_008_AMOUNT_EXCEEDS_LIMIT: 6007, PULSO_009_DAILY_LIMIT_EXCEEDED: 6008, PULSO_010_UNAUTHORIZED_AGENT: 6009, PULSO_011_POLICY_CHANGE_FORBIDDEN: 6010 };

const keyString = (key: unknown): string => key instanceof PublicKey ? key.toBase58() : String(key);
const base58Bytes = (value: string): Uint8Array => {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let number = 0n;
  for (const char of value) {
    const digit = alphabet.indexOf(char);
    if (digit < 0) throw new Error("invalid base58");
    number = number * 58n + BigInt(digit);
  }
  const out: number[] = [];
  while (number > 0n) { out.unshift(Number(number & 255n)); number >>= 8n; }
  for (let i = 0; i < value.length && value[i] === "1"; i++) out.unshift(0);
  return Uint8Array.from(out);
};
const bytes = (data: unknown): Uint8Array => {
  if (data instanceof Uint8Array) return data;
  if (typeof data === "string") return base58Bytes(data);
  return new Uint8Array();
};

/** Validate report claims against the fetched confirmed transaction and the intent account it consumed. */
export async function verifyActivityReport(connection: Connection, report: DemoReport): Promise<Verification> {
  if (!report || typeof report !== "object" || report.evidence !== "confirmed_transaction" || typeof report.signature !== "string" || !/^[1-9A-HJ-NP-Za-km-z]{86,88}$/.test(report.signature)) {
    return { kind: "unverified", reason: "Report has no valid transaction signature." };
  }
  try {
    if (new PublicKey(report.programId).toBase58() !== PROGRAM_ID.toBase58()) return { kind: "unverified", reason: "Report program does not match the expected PULSO program." };
    const [tx, status] = await Promise.all([
      connection.getTransaction(report.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }),
      connection.getSignatureStatuses([report.signature], { searchTransactionHistory: true }),
    ]);
    const signatureStatus = status.value[0];
    if (!tx || !signatureStatus || !["confirmed", "finalized"].includes(signatureStatus.confirmationStatus ?? "")) return { kind: "unverified", reason: "RPC has no confirmed transaction for this signature yet." };
    const message = tx.transaction.message as any;
    const keys = [ ...(message.staticAccountKeys ?? message.accountKeys ?? []), ...(tx.meta?.loadedAddresses?.writable ?? []), ...(tx.meta?.loadedAddresses?.readonly ?? []) ].map(keyString);
    const ixs = message.compiledInstructions ?? message.instructions ?? [];
    const matches = ixs.map((ix: any, index: number) => ({ ix, index })).filter(({ ix }: { ix: any }) => {
      const programId = ix.programId ? keyString(ix.programId) : keys[ix.programIdIndex];
      return programId === PROGRAM_ID.toBase58();
    });
    if (matches.length !== 1) return { kind: "unverified", reason: "Transaction does not contain exactly one PULSO instruction." };
    const { ix, index: instructionIndex } = matches[0];
    const data = bytes(ix.data);
    if (data.length !== 32 || !EXECUTE_DISCRIMINATOR.every((v, i) => data[i] === v)) return { kind: "unverified", reason: "PULSO instruction is not execute_transfer." };
    const indexes: number[] = ix.accountKeyIndexes ?? [];
    const ixKeys: string[] = ix.accountKeyIndexes ? indexes.map((i) => keys[i]) : ix.accounts.map((i: number) => keys[i]);
    if (ixKeys.length < 5 || ixKeys[1] !== report.policy) return { kind: "unverified", reason: "Instruction policy does not match the activity report." };
    const amount = new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(8, true).toString();
    const recipient = ixKeys[3];
    if (amount !== report.amount || recipient !== report.recipient) return { kind: "unverified", reason: "Instruction amount or recipient does not match the activity report." };
    if (!tx.meta || JSON.stringify(tx.meta.err) !== JSON.stringify(signatureStatus.err) || Boolean(tx.meta.err) !== (report.status === "rejected")) {
      return { kind: "unverified", reason: "Transaction result does not match reported status." };
    }
    if (report.status !== "rejected" && report.status !== "executed" && report.status !== "autonomous") return { kind: "unverified", reason: "Report status does not describe a transaction result." };
    if (report.status !== "rejected") {
      const receipt = await describeAuthorityReceipt(connection, report.signature, { commitment: "confirmed", cluster: describeRpc(RPC_URL).cluster });
      if (!receipt.ok) return { kind: "unverified", reason: `Authority receipt check failed: ${receipt.reason}.` };
      if (receipt.receipt.policy !== report.policy || receipt.receipt.amount !== report.amount || receipt.receipt.recipient !== report.recipient) {
        return { kind: "unverified", reason: "Verified receipt fields do not match the activity report." };
      }
      if ((report.status === "autonomous" && receipt.receipt.mode !== "autonomous") || (report.status === "executed" && receipt.receipt.mode !== "approved")) {
        return { kind: "unverified", reason: "Verified transaction mode does not match the activity report." };
      }
      if (report.actionHash && receipt.receipt.actionHash !== report.actionHash) return { kind: "unverified", reason: "Reported action hash does not match the verified receipt." };
      return { kind: "verified", signature: report.signature, status: report.status, policy: report.policy, amount, recipient, programId: PROGRAM_ID.toBase58(), ...(receipt.receipt.actionHash && { actionHash: receipt.receipt.actionHash }) };
    }
    if (report.status === "rejected") {
      const expectedCode = report.code;
      const expectedNumber = expectedCode && ERROR_CODES[expectedCode];
      const logs = tx.meta.logMessages ?? [];
      const chainError = tx.meta.err as { InstructionError?: [number, { Custom?: number }] } | null;
      const failedAtInstruction = chainError?.InstructionError;
      const invokeMarker = `Program ${PROGRAM_ID.toBase58()} invoke`;
      const endMarker = new RegExp(`^Program ${PROGRAM_ID.toBase58()} (?:success|failed:)`);
      const invokeIndex = logs.findIndex((line) => line.startsWith(invokeMarker));
      const endIndex = invokeIndex < 0 ? -1 : logs.findIndex((line, i) => i > invokeIndex && endMarker.test(line));
      const programLogs = invokeIndex >= 0 && endIndex >= 0 ? logs.slice(invokeIndex, endIndex + 1) : [];
      if (!expectedCode || !expectedNumber || !failedAtInstruction || failedAtInstruction[0] !== instructionIndex || failedAtInstruction[1]?.Custom !== expectedNumber || !programLogs.some((line) => line.includes(expectedCode)) || !programLogs.some((line) => line.includes(String(expectedNumber)))) {
        return { kind: "unverified", reason: "Confirmed transaction rejection does not contain the reported PULSO error." };
      }
      if (report.actionHash) {
        const intentKey = ixKeys[5];
        if (!intentKey || !/^[0-9a-f]{64}$/i.test(report.actionHash)) return { kind: "unverified", reason: "Reported action hash has no matching intent account." };
        const account = await connection.getAccountInfo(new PublicKey(intentKey), "confirmed");
        const policyAccount = await connection.getAccountInfo(new PublicKey(report.policy), "confirmed");
        const intentDiscriminator = [150, 220, 148, 182, 20, 199, 128, 11];
        const policyDiscriminator = [148, 193, 218, 129, 21, 96, 195, 77];
        if (!account || !policyAccount || account.owner.toBase58() !== PROGRAM_ID.toBase58() || policyAccount.owner.toBase58() !== PROGRAM_ID.toBase58() || account.data.length !== 126 || policyAccount.data.length !== 120 || !intentDiscriminator.every((byte, i) => account.data[i] === byte) || !policyDiscriminator.every((byte, i) => policyAccount.data[i] === byte)) {
          return { kind: "unverified", reason: "Intent or policy account could not be verified on the PULSO program." };
        }
        const actualHash = Array.from(account.data.subarray(72, 104), (byte) => byte.toString(16).padStart(2, "0")).join("");
        if (actualHash !== report.actionHash.toLowerCase()) return { kind: "unverified", reason: "Reported action hash does not match on-chain intent." };
        const authority = new PublicKey(policyAccount.data.subarray(8, 40));
        const policyAgent = new PublicKey(policyAccount.data.subarray(40, 72));
        if (policyAgent.toBase58() !== ixKeys[0] || !findPolicyPda(authority, policyAgent, PROGRAM_ID).equals(new PublicKey(report.policy))) return { kind: "unverified", reason: "Policy authority or address does not match the failed transaction." };
        if (!findIntentPda(authority, account.data.subarray(72, 104), PROGRAM_ID).equals(new PublicKey(intentKey))) return { kind: "unverified", reason: "Intent address does not match its on-chain authority and action hash." };
      }
      return { kind: "verified", signature: report.signature, status: report.status, policy: report.policy, amount, recipient, programId: PROGRAM_ID.toBase58(), ...(report.actionHash && { actionHash: report.actionHash }), errorCode: expectedCode };
    }
    return { kind: "verified", signature: report.signature, status: report.status, policy: report.policy, amount, recipient, programId: PROGRAM_ID.toBase58(), ...(report.actionHash && { actionHash: report.actionHash }) };
  } catch {
    return { kind: "unverified", reason: "Configured RPC is unavailable or returned malformed transaction data." };
  }
}

export function matchCachedReport(report: DemoReport, cached: Verification): Verification {
  if (cached.kind === "unverified") return cached;
  if (cached.signature !== report.signature || cached.status !== report.status || cached.policy !== report.policy || cached.amount !== report.amount || cached.recipient !== report.recipient || cached.programId !== report.programId) {
    return { kind: "unverified", reason: "This report's fields differ from the RPC-verified transaction." };
  }
  if (report.actionHash && cached.actionHash !== report.actionHash) return { kind: "unverified", reason: "This reported action hash differs from the RPC-verified intent." };
  if (report.code && cached.errorCode !== report.code) return { kind: "unverified", reason: "This reported error differs from the RPC-verified failure." };
  return cached;
}

export function explorerUrl(signature: string, rpcUrl: string): string | null {
  const cluster = /devnet/i.test(rpcUrl) ? "devnet" : /testnet/i.test(rpcUrl) ? "testnet" : /mainnet/i.test(rpcUrl) ? "mainnet-beta" : "";
  if (cluster) return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=${cluster}`;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?$/i.test(rpcUrl)) return `https://explorer.solana.com/tx/${encodeURIComponent(signature)}?cluster=custom&customUrl=${encodeURIComponent(rpcUrl)}`;
  return null;
}

export const DEMO_SCENARIOS = [
  { id: "A–B", title: "A–B · limit and human approval", detail: "5 USDC runs autonomously; 100 USDC waits for wallet approval.", command: "PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario AB --approve ui", evidence: "Live browser wallet approval; A/B activity may be reported." },
  { id: "C", title: "C · tampered amount", detail: "Approve 100, attempt 150 USDC; confirmed PULSO_006 rejection.", command: "PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario C", evidence: "Confirmed failed transaction; select the policy printed by the command." },
  { id: "D", title: "D · tampered recipient", detail: "Keep amount and nonce; change destination token account.", command: "PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario D", evidence: "Confirmed failed transaction; select the policy printed by the command." },
  { id: "E", title: "E · replay", detail: "Reuse a single-use authorization.", command: "PULSO_ACTIVITY_URL=http://localhost:3000 scripts/demo.sh --scenario E", evidence: "Confirmed failed transaction; select the policy printed by the command." },
  { id: "F", title: "F · expiry", detail: "Advance LiteSVM Clock to expires_at + 1.", command: "scripts/demo.sh --scenario F", evidence: "LiteSVM only. No RPC signature or on-chain receipt." },
  { id: "G", title: "G · recipient receipt", detail: "Compare PULSO payment, direct transfer, and challenge replay.", command: "scripts/demo.sh --scenario G", evidence: "Local run; separate test: tests/scenario-g.e2e.test.ts." },
  { id: "B2B", title: "B2B · two companies", detail: "Charge, browser approval, settlement, and reconciliation.", command: "pnpm --filter @pulso/agent-demo b2b-demo -- --cluster localnet", evidence: "Automated rehearsal uses a local human wallet fixture. Live wallet flow uses /network and /approvals." },
  { id: "N1–N3", title: "B2B · network and reconciliation", detail: "Organizations, connection, charge/proposal, and verified receipt.", command: "Open /network, create organizations, connect participants, then open the received request.", evidence: "Commercial consent does not authorize spending. Reconciliation checks the signature on chain." },
] as const;
