import { computeTermsDigest, findPolicyPda, PROGRAM_ID, type B2BTerms } from "@pulso/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createPrivateKey, sign } from "node:crypto";

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Builds packages by hand: the consent message is written out line by line from the spec, on purpose,
// so the tests do not depend on the server code (app/lib/network-auth.ts).

export const GENESIS = Keypair.generate().publicKey.toBase58(); // any 32 bytes work as a stand-in genesis hash
const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");

export const signWith = (kp: Keypair, message: string): string =>
  sign(null, Buffer.from(message, "utf8"), createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, kp.secretKey.subarray(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");

export const envelope = (o: { action: string; authority: string; cluster: string; terms: string; domain?: string }) =>
  [
    "PULSO network consent",
    "NOT A TRANSACTION · grants no spending authority",
    `domain: ${o.domain ?? "pulso.example"}`,
    `action: ${o.action}`,
    `authority: ${o.authority}`,
    `cluster: ${o.cluster}`,
    `terms: ${o.terms}`,
    `nonce: ${Buffer.alloc(32, 9).toString("base64url")}`,
    "issued: 2026-10-02T12:00:00.000Z",
    "expires: 2026-10-02T12:05:00.000Z",
  ].join("\n");

export interface Parties {
  payer: Keypair;
  receiver: Keypair;
  agent: Keypair;
  mint: PublicKey;
  recipientTokenAccount: PublicKey;
}

export const newParties = (): Parties => ({
  payer: Keypair.generate(),
  receiver: Keypair.generate(),
  agent: Keypair.generate(),
  mint: Keypair.generate().publicKey,
  recipientTokenAccount: Keypair.generate().publicKey,
});

export interface PackageOptions {
  kind?: "charge" | "send";
  amount?: bigint;
  /** Unix seconds. */
  expiry?: bigint;
  nonce?: Buffer;
  genesis?: string;
  programId?: PublicKey;
  /** Overrides the derived policy PDA (digest and consents are then built around it). */
  policy?: PublicKey;
}

export function buildPackage(p: Parties, o: PackageOptions = {}) {
  const kind = o.kind ?? "charge";
  const genesis = o.genesis ?? GENESIS;
  const programId = o.programId ?? PROGRAM_ID;
  const nonce = o.nonce ?? Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex");
  const terms: B2BTerms = {
    kind,
    genesis: new PublicKey(genesis).toBytes(),
    programId,
    policy: o.policy ?? findPolicyPda(p.payer.publicKey, p.agent.publicKey, programId),
    payerAuthority: p.payer.publicKey,
    agent: p.agent.publicKey,
    mint: p.mint,
    recipientTokenAccount: p.recipientTokenAccount,
    receiverAuthority: p.receiver.publicKey,
    amount: o.amount ?? 5_000_000n,
    nonce,
    expiry: o.expiry ?? 4_000_000_000n,
  };
  const digest = Buffer.from(computeTermsDigest(terms)).toString("hex");
  const consentFor = (action: string, kp: Keypair) => {
    const message = envelope({ action, authority: kp.publicKey.toBase58(), cluster: genesis, terms: digest });
    return { action, message, signature: signWith(kp, message), signer: kp.publicKey.toBase58(), at: "2026-10-02T12:00:01.000Z" };
  };
  const consent =
    kind === "charge"
      ? [consentFor("network.charge.issue", p.receiver)]
      : [consentFor("network.send.propose", p.payer), consentFor("network.send.accept", p.receiver)];
  return {
    version: "pulso-b2b-package-v1",
    requestId: nonce.toString("hex"),
    kind,
    status: "aguardando autorização",
    ready: true,
    digest,
    snapshot: {
      kind,
      genesis,
      programId: programId.toBase58(),
      policy: terms.policy.toBase58(),
      payerAuthority: p.payer.publicKey.toBase58(),
      agent: p.agent.publicKey.toBase58(),
      mint: p.mint.toBase58(),
      recipientTokenAccount: p.recipientTokenAccount.toBase58(),
      receiverAuthority: p.receiver.publicKey.toBase58(),
      amount: terms.amount.toString(),
      nonce: nonce.toString("hex"),
      expiry: terms.expiry.toString(),
    },
    consent,
  };
}

export type Pkg = ReturnType<typeof buildPackage>;
export const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
