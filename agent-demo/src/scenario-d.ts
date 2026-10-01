import anchor from "@anchor-lang/core";
import { getAccount, getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { PULSO_ERRORS, PulsoClient, findIntentPda, getProgram } from "@pulso/sdk";
import { sendConfirmedFailure } from "./confirmed-failure.js";
import { loadKeypair, usdc, type DemoAddresses } from "./setup.js";

const { BN } = anchor;

export interface ScenarioDResult {
  decision: "REJECTED";
  error: "PULSO_006_INTENT_MISMATCH";
  errorCode: number;
  signature: string;
  confirmed: true;
  authorizedAmount: string;
  attemptedAmount: string;
  authorizedRecipient: string;
  attemptedRecipient: string;
  authorizedMint: string;
  attemptedMint: string;
  vaultBefore: string;
  vaultAfter: string;
  authorizedRecipientBefore: string;
  authorizedRecipientAfter: string;
  attemptedRecipientBefore: string;
  attemptedRecipientAfter: string;
  usedCountBefore: number;
  usedCountAfter: number;
}

/** Approve a transfer to merchant, then submit the same amount and nonce to another token account. */
export async function runScenarioD(
  addresses: DemoAddresses,
  log: (line: string) => void = () => {},
): Promise<ScenarioDResult> {
  const connection = new Connection(addresses.rpcUrl, "confirmed");
  const human = loadKeypair(addresses.cluster, "human");
  const agent = loadKeypair(addresses.cluster, "agent");
  const mint = new PublicKey(addresses.mint);
  const authorizedRecipient = new PublicKey(addresses.merchantTokenAccount);
  const client = new PulsoClient({ connection, agent, human: human.publicKey });
  const pending = await client.execute({ amount: usdc(100), recipient: authorizedRecipient });
  if (pending.status !== "HUMAN_INTENT_REQUIRED") {
    throw new Error(`Scenario D expected human approval for 100 USDC; got ${pending.status}`);
  }

  const attemptedRecipient = (await getOrCreateAssociatedTokenAccount(
    connection,
    human,
    mint,
    agent.publicKey,
  )).address;
  if (attemptedRecipient.equals(authorizedRecipient)) throw new Error("Scenario D needs a different destination account");
  const authorizedMint = (await getAccount(connection, authorizedRecipient)).mint;
  const attemptedMint = (await getAccount(connection, attemptedRecipient)).mint;
  if (!authorizedMint.equals(mint) || !attemptedMint.equals(mint)) throw new Error("Scenario D destinations must use the same mint");

  const intentPda = findIntentPda(human.publicKey, pending.intent.actionHash);
  await getProgram(connection, human)
    .methods.recordIntent(
      Array.from(pending.intent.actionHash),
      new BN(pending.intent.fields.expiresAt.toString()),
      pending.intent.fields.maxUses,
    )
    .accountsPartial({ authority: human.publicKey, policy: client.policy })
    .rpc();

  const agentProgram = getProgram(connection, agent);
  const intentBefore = await agentProgram.account.intentAuthorization.fetch(intentPda);
  const vaultBefore = (await getAccount(connection, client.vault)).amount;
  const authorizedRecipientBefore = (await getAccount(connection, authorizedRecipient)).amount;
  const attemptedRecipientBefore = (await getAccount(connection, attemptedRecipient)).amount;
  const policyBefore = await client.getPolicy();
  if (!policyBefore) throw new Error("Scenario D policy disappeared before attack");

  // Reuse approved amount, nonce, and intent PDA; only destination token account changes.
  const attack = await agentProgram.methods
    .executeTransfer(new BN(pending.intent.fields.amount.toString()), Array.from(pending.intent.nonce))
    .accountsPartial({
      agent: agent.publicKey,
      policy: client.policy,
      vault: client.vault,
      recipient: attemptedRecipient,
      tokenProgram: TOKEN_PROGRAM_ID,
      intent: intentPda,
      recipientApproval: null,
    })
    .transaction();
  const failure = await sendConfirmedFailure(connection, attack, agent, PULSO_ERRORS.IntentMismatch.code, PULSO_ERRORS.IntentMismatch.message);

  const vaultAfter = (await getAccount(connection, client.vault)).amount;
  const authorizedRecipientAfter = (await getAccount(connection, authorizedRecipient)).amount;
  const attemptedRecipientAfter = (await getAccount(connection, attemptedRecipient)).amount;
  const intentAfter = await agentProgram.account.intentAuthorization.fetch(intentPda);
  const policyAfter = await client.getPolicy();
  if (!policyAfter) throw new Error("Scenario D policy disappeared after attack");
  if (
    vaultAfter !== vaultBefore
    || authorizedRecipientAfter !== authorizedRecipientBefore
    || attemptedRecipientAfter !== attemptedRecipientBefore
    || intentAfter.usedCount !== intentBefore.usedCount
    || !policyAfter.spentInWindow.eq(policyBefore.spentInWindow)
  ) {
    throw new Error("Scenario D attack changed balances, intent usage, or policy spending despite rejection");
  }

  log(`  ✓ authorized 100 USDC for ${authorizedRecipient.toBase58()}`);
  log(`  ✓ attempted same amount and nonce at ${attemptedRecipient.toBase58()} (same mint)`);
  log(`  ✓ rejected transaction confirmed  sig=${failure.signature}`);
  log(`  ✕ ${PULSO_ERRORS.IntentMismatch.message} (${failure.errorCode})`);
  log(`  ✓ vault and both recipient balances unchanged; intent used_count=${intentAfter.usedCount}`);
  return {
    decision: "REJECTED",
    error: PULSO_ERRORS.IntentMismatch.message as ScenarioDResult["error"],
    errorCode: failure.errorCode,
    signature: failure.signature,
    confirmed: true,
    authorizedAmount: pending.intent.fields.amount.toString(),
    attemptedAmount: usdc(100).toString(),
    authorizedRecipient: authorizedRecipient.toBase58(),
    attemptedRecipient: attemptedRecipient.toBase58(),
    authorizedMint: authorizedMint.toBase58(),
    attemptedMint: attemptedMint.toBase58(),
    vaultBefore: vaultBefore.toString(),
    vaultAfter: vaultAfter.toString(),
    authorizedRecipientBefore: authorizedRecipientBefore.toString(),
    authorizedRecipientAfter: authorizedRecipientAfter.toString(),
    attemptedRecipientBefore: attemptedRecipientBefore.toString(),
    attemptedRecipientAfter: attemptedRecipientAfter.toString(),
    usedCountBefore: intentBefore.usedCount,
    usedCountAfter: intentAfter.usedCount,
  };
}
