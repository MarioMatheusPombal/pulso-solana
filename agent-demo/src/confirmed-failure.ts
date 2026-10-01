import { Connection, Keypair, Transaction } from "@solana/web3.js";

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
