import anchor from "@anchor-lang/core";
import { findPolicyPda, getProgram, type PendingApproval } from "@pulso/sdk";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createPrivateKey, sign as edSign } from "node:crypto";

const { BN } = anchor;

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// WALLET FIXTURE. This file is the only place of the B2B demo that holds a HUMAN private key. It stands in for the
// wallet in the browser: it signs the server's exact messages and the on-chain `record_intent`, and it exposes
// nothing else (no getter for the key). The agent side (`b2b-demo.ts` -> `executePackage`) receives only the agent
// keypair and public keys. In the live demo this file is not used: the human signs in the browser.

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export class WalletFixture {
  readonly publicKey: PublicKey;
  readonly #key: Keypair;

  constructor(key: Keypair) {
    this.#key = key;
    this.publicKey = key.publicKey;
  }

  /** What `signMessage` does in a wallet: Ed25519 over the exact UTF-8 bytes, base64. */
  signMessage(message: string): string {
    const der = Buffer.concat([PKCS8_ED25519, this.#key.secretKey.slice(0, 32)]);
    return edSign(null, Buffer.from(message, "utf8"), createPrivateKey({ key: der, format: "der", type: "pkcs8" })).toString("base64");
  }

  /** The human approval: records the intent for exactly the action hash the agent printed. */
  async recordIntent(connection: Connection, agent: PublicKey, pending: PendingApproval): Promise<string> {
    return getProgram(connection, this.#key)
      .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
      .accountsPartial({ authority: this.publicKey, policy: findPolicyPda(this.publicKey, agent) })
      .rpc();
  }

  /** Setup only (the browser does this in /policy): policy and vault of this authority for one agent. */
  async createPolicyAndVault(connection: Connection, agent: PublicKey, mint: PublicKey, p: { maxPerTransaction: bigint; daily: bigint; approvalThreshold: bigint }): Promise<PublicKey> {
    const program = getProgram(connection, this.#key);
    const policy = findPolicyPda(this.publicKey, agent);
    await program.methods
      .createPolicy(new BN(p.maxPerTransaction.toString()), new BN(p.daily.toString()), false, new BN(p.approvalThreshold.toString()))
      .accountsPartial({ human: this.publicKey, agent })
      .rpc();
    await program.methods.createVault().accountsPartial({ human: this.publicKey, policy, mint }).rpc();
    return policy;
  }
}
