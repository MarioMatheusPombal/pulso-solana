import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { PROGRAM_ID, findIntentPda, findPolicyPda, findRecipientApprovalPda, findVaultPda } from "../src/program.js";

const enc = new TextEncoder();
const [a, b, c] = [Keypair.generate().publicKey, Keypair.generate().publicKey, Keypair.generate().publicKey];
const pda = (seeds: Uint8Array[]) => PublicKey.findProgramAddressSync(seeds, PROGRAM_ID)[0];

describe("PDAs", () => {
  it("program id matches the deployed one", () => {
    expect(PROGRAM_ID.toBase58()).toBe("4jdHys9YsHTbVQxB6YAr7R8jsmoEy7wqcpxC9tk2dqQi");
  });
  it("match the program seeds", () => {
    const hash = new Uint8Array(32).fill(7);
    const policy = findPolicyPda(a, b);
    expect(policy).toEqual(pda([enc.encode("policy"), a.toBytes(), b.toBytes()]));
    expect(findVaultPda(policy)).toEqual(pda([enc.encode("vault"), policy.toBytes()]));
    expect(findIntentPda(a, hash)).toEqual(pda([enc.encode("intent"), a.toBytes(), hash]));
    expect(findRecipientApprovalPda(policy, c)).toEqual(pda([enc.encode("recipient"), policy.toBytes(), c.toBytes()]));
  });
});
