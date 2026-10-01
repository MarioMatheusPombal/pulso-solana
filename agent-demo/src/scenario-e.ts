import anchor from "@anchor-lang/core";
import { getAccount, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { ComputeBudgetProgram, Connection, PublicKey } from "@solana/web3.js";
import { PULSO_ERRORS, PulsoClient, findIntentPda, getProgram } from "@pulso/sdk";
import { sendConfirmedFailure, sendConfirmedTransaction } from "./confirmed-failure.js";
import { loadKeypair, usdc, type DemoAddresses } from "./setup.js";

const { BN } = anchor;

export interface ScenarioEResult {
  decision: "EXECUTED_ONCE_REPLAY_REJECTED";
  concurrentSignatures: [string, string];
  concurrentSuccessSignature: string;
  concurrentReplaySignature: string;
  sequentialReplaySignature: string;
  errorCode: number;
  vaultBefore: string;
  vaultAfter: string;
  recipientBefore: string;
  recipientAfter: string;
  usedCountBefore: number;
  usedCountAfter: number;
  spentBefore: string;
  spentAfter: string;
}

/** Race distinct raw transactions against the same one-use approval, then replay it sequentially. */
export async function runScenarioE(
  addresses: DemoAddresses,
  log: (line: string) => void = () => {},
): Promise<ScenarioEResult> {
  const connection = new Connection(addresses.rpcUrl, "confirmed");
  const human = loadKeypair(addresses.cluster, "human");
  const agent = loadKeypair(addresses.cluster, "agent");
  const recipient = new PublicKey(addresses.merchantTokenAccount);
  const client = new PulsoClient({ connection, agent, human: human.publicKey });
  const pending = await client.execute({ amount: usdc(100), recipient });
  if (pending.status !== "HUMAN_INTENT_REQUIRED") throw new Error(`Scenario E expected human approval for 100 USDC; got ${pending.status}`);

  const intentPda = findIntentPda(human.publicKey, pending.intent.actionHash);
  await getProgram(connection, human).methods
    .recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
    .accountsPartial({ authority: human.publicKey, policy: client.policy })
    .rpc();

  const program = getProgram(connection, agent);
  const intentBefore = await program.account.intentAuthorization.fetch(intentPda);
  const vaultBefore = (await getAccount(connection, client.vault)).amount;
  const recipientBefore = (await getAccount(connection, recipient)).amount;
  const policyBefore = await client.getPolicy();
  if (!policyBefore) throw new Error("Scenario E policy disappeared before replay test");

  const buildTransfer = async (computeUnits: number) => {
    const tx = await program.methods
      .executeTransfer(new BN(pending.intent.fields.amount.toString()), Array.from(pending.intent.nonce))
      .accountsPartial({ agent: agent.publicKey, policy: client.policy, vault: client.vault, recipient, tokenProgram: TOKEN_PROGRAM_ID, intent: intentPda, recipientApproval: null })
      .transaction();
    tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnits }));
    tx.instructions.unshift(tx.instructions.pop()!);
    return tx;
  };

  // Distinct compute-budget instructions give separate signatures without changing transfer data.
  const [firstTransfer, secondTransfer] = await Promise.all([buildTransfer(200_000), buildTransfer(201_000)]);
  const concurrent = await Promise.all([
    sendConfirmedTransaction(connection, firstTransfer, agent),
    sendConfirmedTransaction(connection, secondTransfer, agent),
  ]);
  if (concurrent[0].signature === concurrent[1].signature) throw new Error("Scenario E concurrent submissions must have distinct signatures");
  const successes = concurrent.filter((item) => item.succeeded);
  const failures = concurrent.filter((item) => !item.succeeded);
  if (successes.length !== 1 || failures.length !== 1 || failures[0]!.errorCode !== PULSO_ERRORS.IntentAlreadyUsed.code
    || !failures[0]!.logs.some((line) => line.includes(PULSO_ERRORS.IntentAlreadyUsed.message))) {
    throw new Error(`Expected one successful concurrent receipt and one ${PULSO_ERRORS.IntentAlreadyUsed.message}; got ${concurrent.map((item) => `${item.signature}:${item.errorCode ?? "success"}`).join(", ")}`);
  }

  const sequentialReplay = await sendConfirmedFailure(
    connection,
    await buildTransfer(202_000),
    agent,
    PULSO_ERRORS.IntentAlreadyUsed.code,
    PULSO_ERRORS.IntentAlreadyUsed.message,
  );
  if (concurrent.some((item) => item.signature === sequentialReplay.signature)) throw new Error("Scenario E sequential replay must have a distinct signature");

  const vaultAfter = (await getAccount(connection, client.vault)).amount;
  const recipientAfter = (await getAccount(connection, recipient)).amount;
  const intentAfter = await program.account.intentAuthorization.fetch(intentPda);
  const policyAfter = await client.getPolicy();
  if (!policyAfter) throw new Error("Scenario E policy disappeared after replay test");
  if (
    vaultBefore - vaultAfter !== usdc(100)
    || recipientAfter - recipientBefore !== usdc(100)
    || intentBefore.usedCount !== 0
    || intentAfter.usedCount !== 1
    || !policyAfter.spentInWindow.sub(policyBefore.spentInWindow).eq(new BN(usdc(100).toString()))
  ) throw new Error("Scenario E expected exactly one 100 USDC transfer and one used intent");

  const success = successes[0]!;
  const replay = failures[0]!;
  log("  ✓ submitted two distinct transactions for the same one-use 100 USDC intent concurrently");
  log(`  ✓ one confirmed success  sig=${success.signature}`);
  log(`  ✓ concurrent replay confirmed ${PULSO_ERRORS.IntentAlreadyUsed.message} (${replay.errorCode})  sig=${replay.signature}`);
  log(`  ✓ sequential replay confirmed ${PULSO_ERRORS.IntentAlreadyUsed.message} (${sequentialReplay.errorCode})  sig=${sequentialReplay.signature}`);
  log("  ✓ vault, recipient, and policy spending changed by exactly 100 USDC; used_count=1");
  return {
    decision: "EXECUTED_ONCE_REPLAY_REJECTED",
    concurrentSignatures: [concurrent[0].signature, concurrent[1].signature],
    concurrentSuccessSignature: success.signature,
    concurrentReplaySignature: replay.signature,
    sequentialReplaySignature: sequentialReplay.signature,
    errorCode: replay.errorCode!,
    vaultBefore: vaultBefore.toString(), vaultAfter: vaultAfter.toString(),
    recipientBefore: recipientBefore.toString(), recipientAfter: recipientAfter.toString(),
    usedCountBefore: intentBefore.usedCount, usedCountAfter: intentAfter.usedCount,
    spentBefore: policyBefore.spentInWindow.toString(), spentAfter: policyAfter.spentInWindow.toString(),
  };
}
