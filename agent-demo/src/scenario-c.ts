import anchor from "@anchor-lang/core";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { PULSO_ERRORS, PulsoClient, findIntentPda, getProgram } from "@pulso/sdk";
import { sendConfirmedFailure } from "./confirmed-failure.js";
import { loadKeypair, usdc, type DemoAddresses } from "./setup.js";

const { BN } = anchor;

export interface ScenarioCResult {
  decision: "REJECTED";
  error: "PULSO_006_INTENT_MISMATCH";
  errorCode: number;
  signature: string;
  confirmed: true;
  authorizedAmount: string;
  attemptedAmount: string;
  vaultBefore: string;
  vaultAfter: string;
  recipientBefore: string;
  recipientAfter: string;
  usedCountBefore: number;
  usedCountAfter: number;
}

/** Approve 100 USDC, then attack with 150 USDC using the approved intent PDA and nonce. */
export async function runScenarioC(
  addresses: DemoAddresses,
  log: (line: string) => void = () => {},
): Promise<ScenarioCResult> {
  const connection = new Connection(addresses.rpcUrl, "confirmed");
  const human = loadKeypair(addresses.cluster, "human");
  const agent = loadKeypair(addresses.cluster, "agent");
  const recipient = new PublicKey(addresses.merchantTokenAccount);
  const client = new PulsoClient({ connection, agent, human: human.publicKey });
  const pending = await client.execute({ amount: usdc(100), recipient });
  if (pending.status !== "HUMAN_INTENT_REQUIRED") {
    throw new Error(`Scenario C expected human approval for 100 USDC; got ${pending.status}`);
  }

  const intentPda = findIntentPda(human.publicKey, pending.intent.actionHash);
  await getProgram(connection, human)
    .methods.recordIntent(
      Array.from(pending.intent.actionHash),
      new BN(pending.intent.fields.expiresAt.toString()),
      pending.intent.fields.maxUses,
    )
    .accountsPartial({ authority: human.publicKey, policy: client.policy })
    .rpc();

  const policyProgram = getProgram(connection, agent);
  const intentBefore = await policyProgram.account.intentAuthorization.fetch(intentPda);
  const vaultBefore = (await getAccount(connection, client.vault)).amount;
  const recipientBefore = (await getAccount(connection, recipient)).amount;
  const policyBefore = await client.getPolicy();
  if (!policyBefore) throw new Error("Scenario C policy disappeared before attack");

  // Deliberately bypass PulsoClient.executeApproved to submit a tampered on-chain instruction.
  const attack = await policyProgram.methods
    .executeTransfer(new BN(usdc(150).toString()), Array.from(pending.intent.nonce))
    .accountsPartial({
      agent: agent.publicKey,
      policy: client.policy,
      vault: client.vault,
      recipient,
      tokenProgram: TOKEN_PROGRAM_ID,
      intent: intentPda,
      recipientApproval: null,
    })
    .transaction();
  const failure = await sendConfirmedFailure(connection, attack, agent, PULSO_ERRORS.IntentMismatch.code, PULSO_ERRORS.IntentMismatch.message);

  const vaultAfter = (await getAccount(connection, client.vault)).amount;
  const recipientAfter = (await getAccount(connection, recipient)).amount;
  const intentAfter = await policyProgram.account.intentAuthorization.fetch(intentPda);
  const policyAfter = await client.getPolicy();
  if (!policyAfter) throw new Error("Scenario C policy disappeared after attack");
  if (vaultAfter !== vaultBefore || recipientAfter !== recipientBefore || intentAfter.usedCount !== intentBefore.usedCount || !policyAfter.spentInWindow.eq(policyBefore.spentInWindow)) {
    throw new Error("Scenario C attack changed balances, intent usage, or policy spending despite rejection");
  }

  log("  ✓ authorized 100 USDC, attempted 150 USDC with same intent hash and nonce");
  log(`  ✓ rejected transaction confirmed  sig=${failure.signature}`);
  log(`  ✕ ${PULSO_ERRORS.IntentMismatch.message} (${failure.errorCode})`);
  log(`  ✓ vault and recipient balances unchanged; intent used_count=${intentAfter.usedCount}`);
  return {
    decision: "REJECTED",
    error: PULSO_ERRORS.IntentMismatch.message as ScenarioCResult["error"],
    errorCode: failure.errorCode,
    signature: failure.signature,
    confirmed: true,
    authorizedAmount: usdc(100).toString(),
    attemptedAmount: usdc(150).toString(),
    vaultBefore: vaultBefore.toString(),
    vaultAfter: vaultAfter.toString(),
    recipientBefore: recipientBefore.toString(),
    recipientAfter: recipientAfter.toString(),
    usedCountBefore: intentBefore.usedCount,
    usedCountAfter: intentAfter.usedCount,
  };
}
