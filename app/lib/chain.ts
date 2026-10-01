import { BN, Program } from "@anchor-lang/core";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import type { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { findPolicyPda, findVaultPda } from "@pulso/sdk/src/pda.js";
import type { PulsoPolicy } from "@pulso/sdk";
import type { Pulso } from "@pulso/sdk/src/idl/pulso.js";
import idl from "@pulso/sdk/src/idl/pulso.json";
import type { PolicyArgs } from "./policy";

// The SDK's getProgram() needs Anchor's Node-only `Wallet`, which the browser build of @anchor-lang/core does not export.
// Reads and instruction building need no wallet, so build the Program from a connection-only provider.
function getProgram(connection: Connection): Program<Pulso> {
  return new Program<Pulso>(idl as Pulso, { connection });
}

export async function fetchPolicy(connection: Connection, human: PublicKey, agent: PublicKey): Promise<PulsoPolicy | null> {
  return getProgram(connection).account.agentPolicy.fetchNullable(findPolicyPda(human, agent));
}

/** Vault balance in base units, or null if the vault does not exist. */
export async function fetchVaultBalance(connection: Connection, policy: PublicKey): Promise<bigint | null> {
  try {
    const r = await connection.getTokenAccountBalance(findVaultPda(policy));
    return BigInt(r.value.amount);
  } catch {
    return null;
  }
}

/** create_policy + create_vault, both signed by the human's wallet. */
export async function buildCreatePolicyIxs(connection: Connection, human: PublicKey, a: PolicyArgs): Promise<TransactionInstruction[]> {
  const program = getProgram(connection);
  const policy = findPolicyPda(human, a.agent);
  const createPolicy = await program.methods
    .createPolicy(
      new BN(a.maxPerTransaction.toString()),
      new BN(a.dailyLimit.toString()),
      a.requireApprovalForNewRecipient,
      new BN(a.requireApprovalAbove.toString()),
    )
    .accountsPartial({ human, agent: a.agent, policy })
    .instruction();
  const createVault = await program.methods
    .createVault()
    .accountsPartial({ human, policy, mint: a.mint, tokenProgram: TOKEN_PROGRAM_ID })
    .instruction();
  return [createPolicy, createVault];
}

/** record_intent signed by the human's wallet, with exactly the arguments produced by prepareApproval. */
export async function buildRecordIntentIx(
  connection: Connection,
  authority: PublicKey,
  policy: PublicKey,
  a: { actionHash: Uint8Array; expiresAt: bigint; maxUses: number },
): Promise<TransactionInstruction> {
  return getProgram(connection)
    .methods.recordIntent(Array.from(a.actionHash), new BN(a.expiresAt.toString()), a.maxUses)
    .accountsPartial({ authority, policy })
    .instruction();
}
