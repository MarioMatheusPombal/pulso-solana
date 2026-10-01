import { AnchorProvider, Program, Wallet } from "@anchor-lang/core";
import { Connection, Keypair } from "@solana/web3.js";
import idl from "./idl/pulso.json" with { type: "json" };
import type { Pulso } from "./idl/pulso.js";
import {
  findIntentPda,
  findPolicyPda,
  findRecipientApprovalPda,
  findVaultPda,
  PROGRAM_ID,
} from "./pda.js";

export type { Pulso };
export { findIntentPda, findPolicyPda, findRecipientApprovalPda, findVaultPda, PROGRAM_ID };

/** Typed program client from the bundled IDL. Without `wallet` it uses a throwaway key: reads and simulations only. */
export function getProgram(connection: Connection, wallet?: Keypair | Wallet): Program<Pulso> {
  const w = wallet === undefined ? new Wallet(Keypair.generate()) : "secretKey" in wallet ? new Wallet(wallet) : wallet;
  return new Program<Pulso>(idl as Pulso, new AnchorProvider(connection, w, { commitment: "confirmed" }));
}
