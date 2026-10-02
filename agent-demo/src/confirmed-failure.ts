import { Connection, Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { PROGRAM_ID } from "@pulso/sdk";

export interface ConfirmedTransaction {
  signature: string;
  succeeded: boolean;
  errorCode: number | undefined;
  logs: string[];
}

/** Submit without preflight and return the confirmed receipt, whether it succeeds or fails. */
export async function sendConfirmedTransaction(
  connection: Connection,
  transaction: Transaction,
  signer: Keypair,
): Promise<ConfirmedTransaction> {
  const latest = await connection.getLatestBlockhash("confirmed");
  transaction.feePayer = signer.publicKey;
  transaction.recentBlockhash = latest.blockhash;
  transaction.sign(signer);
  const signature = await connection.sendRawTransaction(transaction.serialize(), { skipPreflight: true });
  const confirmation = await connection.confirmTransaction({ signature, ...latest }, "confirmed");
  const receipt = await connection.getTransaction(signature, {
    commitment: "confirmed",
    maxSupportedTransactionVersion: 0,
  });
  if (!receipt?.meta) throw new Error(`No confirmed transaction receipt for ${signature}`);
  const failed = receipt.meta.err !== null;
  if (Boolean(confirmation.value.err) !== failed) throw new Error(`Confirmation and receipt disagree for ${signature}`);
  const instructionError = (receipt.meta.err as unknown as { InstructionError?: [number, { Custom?: number }] } | null)?.InstructionError;
  const errorCode = instructionError?.[1]?.Custom;
  return { signature, succeeded: !failed, errorCode, logs: receipt.meta.logMessages ?? [] };
}

/** Submit without preflight, then prove expected on-chain failure from the confirmed receipt. */
export async function sendConfirmedFailure(
  connection: Connection,
  transaction: Transaction,
  signer: Keypair,
  expectedCode: number,
  expectedLogMessage: string,
): Promise<{ signature: string; errorCode: number; errorLog: string }> {
  const receipt = await sendConfirmedTransaction(connection, transaction, signer);
  const errorLog = receipt.logs.find((line) => line.includes(expectedLogMessage));
  if (receipt.succeeded || receipt.errorCode !== expectedCode || !errorLog) {
    throw new Error(`Expected confirmed error ${expectedCode} and log ${expectedLogMessage}; code=${receipt.errorCode}, logs=${receipt.logs.join(" | ")}`);
  }
  return { signature: receipt.signature, errorCode: receipt.errorCode, errorLog };
}

/** Display-only report of a confirmed transaction for the app timeline. Best-effort: never throws, never authorizes. */
export async function reportConfirmed(
  activityUrl: string | undefined,
  a: {
    status: "rejected" | "executed";
    authority: PublicKey;
    agent: PublicKey;
    policy: PublicKey;
    amount: bigint;
    recipient: PublicKey;
    actionHash: Uint8Array;
    signature: string;
    code?: string;
  },
): Promise<void> {
  if (!activityUrl) return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 750);
  try {
    await fetch(`${activityUrl.replace(/\/+$/, "")}/api/activity`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        eventId: globalThis.crypto.randomUUID(),
        status: a.status,
        evidence: "confirmed_transaction",
        authority: a.authority.toBase58(),
        agent: a.agent.toBase58(),
        programId: PROGRAM_ID.toBase58(),
        policy: a.policy.toBase58(),
        amount: a.amount.toString(),
        recipient: a.recipient.toBase58(),
        actionHash: Buffer.from(a.actionHash).toString("hex"),
        ...(a.code && { code: a.code }),
        signature: a.signature,
      }),
      signal: controller.signal,
    });
  } catch {
    // Telemetry must never change the scenario result.
  } finally {
    clearTimeout(timer);
  }
}
