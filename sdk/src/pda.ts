import { PublicKey } from "@solana/web3.js";
import idl from "./idl/pulso.json" with { type: "json" };

export const PROGRAM_ID = new PublicKey(idl.address);

const enc = new TextEncoder();
const seed = (s: string) => enc.encode(s);

export function findPolicyPda(human: PublicKey, agent: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("policy"), human.toBytes(), agent.toBytes()], programId)[0];
}

export function findVaultPda(policy: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("vault"), policy.toBytes()], programId)[0];
}

export function findIntentPda(authority: PublicKey, actionHash: Uint8Array, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("intent"), authority.toBytes(), actionHash], programId)[0];
}

/** `recipient` is the destination token account address. */
export function findRecipientApprovalPda(policy: PublicKey, recipient: PublicKey, programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync([seed("recipient"), policy.toBytes(), recipient.toBytes()], programId)[0];
}
