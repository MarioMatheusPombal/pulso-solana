import anchor from "@anchor-lang/core";
import { PROGRAM_ID, PulsoClient, PulsoProgramError, findPolicyPda, getProgram } from "@pulso/sdk";
import { getAccount } from "@solana/spl-token";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RecordingConnection, executePackage } from "../src/b2b.js";
import { loadKeypair, setup, usdc, type DemoAddresses } from "../src/setup.js";
import { startValidator, type LocalValidator } from "../src/validator.js";
import { buildPackage, clone } from "./b2b-fixtures.js";

const { BN } = anchor;

// Real validator, real program, real PulsoClient: the package is validated offline, then executed.
let validator: LocalValidator;
let addresses: DemoAddresses;
let stateDir: string;
let connection: RecordingConnection;
const human = () => loadKeypair("localnet", "human");
const agent = () => loadKeypair("localnet", "agent");

beforeAll(async () => {
  validator = await startValidator({ programId: PROGRAM_ID.toBase58(), soPath: resolve(import.meta.dirname, "../../target/deploy/pulso.so"), rpcPort: 8899, faucetPort: 9900 });
  addresses = await setup({ cluster: "localnet" });
  connection = new RecordingConnection(addresses.rpcUrl, "confirmed");
  stateDir = mkdtempSync(join(tmpdir(), "pulso-b2b-e2e-"));
});
afterAll(async () => {
  await validator?.stop();
  rmSync(stateDir, { recursive: true, force: true });
});

const parties = () => ({ payer: human(), receiver: Keypair.generate(), agent: agent(), mint: new PublicKey(addresses.mint), recipientTokenAccount: new PublicKey(addresses.merchantTokenAccount) });
const nonceOf = (n: number) => Buffer.alloc(16, n);
const balance = async (a: string) => (await getAccount(connection, new PublicKey(a))).amount;

async function pkgFor(amount: bigint, nonce: Buffer) {
  const genesis = await connection.getGenesisHash();
  return buildPackage(parties(), { amount, nonce, genesis, expiry: BigInt(Math.floor(Date.now() / 1000) + 600) });
}

const run = (pkg: unknown, auto = false) =>
  executePackage({
    pkg,
    agent: agent().publicKey,
    connection,
    stateDir,
    waitOptions: { timeoutMs: 30_000, initialDelayMs: 200, maxDelayMs: 1_000 },
    makeClient: (h) => new PulsoClient({ connection, agent: agent(), human: h }),
    onPause: auto
      ? async (pending) => {
          // Localnet fixture simulates the authority, as in scenario B.
          await getProgram(new Connection(addresses.rpcUrl, "confirmed"), human())
            .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
            .accountsPartial({ authority: human().publicKey, policy: findPolicyPda(human().publicKey, agent().publicKey) })
            .rpc();
        }
      : undefined,
  });

/** Amount and nonce as the program received them: execute_transfer data = 8-byte discriminator, u64 LE, 16 bytes. */
async function onChainArgs(signature: string) {
  const tx = await connection.getTransaction(signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
  const ix = tx!.transaction.message.compiledInstructions.find((i) => tx!.transaction.message.staticAccountKeys[i.programIdIndex]!.equals(PROGRAM_ID))!;
  const data = Buffer.from(ix.data);
  return { amount: data.readBigUInt64LE(8), nonce: data.subarray(16, 32).toString("hex") };
}

describe("b2b adapter against a real validator (issue 309)", () => {
  it("autonomous branch: executes the exact amount, destination and nonce, then does not repeat", async () => {
    const pkg = await pkgFor(usdc(5), nonceOf(1));
    const [vault0, merchant0] = [await balance(addresses.vault), await balance(addresses.merchantTokenAccount)];
    const out = await run(pkg);
    expect(out).toMatchObject({ status: "executed", mode: "autonomous", alreadySent: false });
    if (out.status !== "executed") throw new Error("unreachable");
    expect(await onChainArgs(out.signature)).toEqual({ amount: usdc(5), nonce: nonceOf(1).toString("hex") });
    expect(vault0 - (await balance(addresses.vault))).toBe(usdc(5));
    expect((await balance(addresses.merchantTokenAccount)) - merchant0).toBe(usdc(5));

    const again = await run(pkg); // same request, same state dir: reports the signature, spends nothing
    expect(again).toMatchObject({ signature: out.signature, mode: "autonomous", alreadySent: true });
    expect(vault0 - (await balance(addresses.vault))).toBe(usdc(5));
  });

  it("approved branch: pauses, waits for the on-chain intent, then executes the exact action once", async () => {
    const pkg = await pkgFor(usdc(100), nonceOf(2));
    expect(await run(pkg)).toMatchObject({ status: "paused" }); // no approver: nothing leaves the vault
    const [vault0, merchant0] = [await balance(addresses.vault), await balance(addresses.merchantTokenAccount)];
    const out = await run(pkg, true);
    expect(out).toMatchObject({ status: "executed", mode: "approved" });
    if (out.status !== "executed") throw new Error("unreachable");
    expect(await onChainArgs(out.signature)).toEqual({ amount: usdc(100), nonce: nonceOf(2).toString("hex") });
    expect(vault0 - (await balance(addresses.vault))).toBe(usdc(100));
    expect((await balance(addresses.merchantTokenAccount)) - merchant0).toBe(usdc(100));
    expect(await run(pkg, true)).toMatchObject({ signature: out.signature, alreadySent: true });
    expect(vault0 - (await balance(addresses.vault))).toBe(usdc(100));
  });

  it("a tampered package spends nothing", async () => {
    const vault0 = await balance(addresses.vault);
    const tampered = clone(await pkgFor(usdc(5), nonceOf(3)));
    tampered.snapshot.amount = usdc(400).toString(); // larger amount, digest and consents left as signed
    await expect(run(tampered)).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    const lying = { ...(await pkgFor(usdc(5), nonceOf(4))), ready: true, status: "aguardando autorização", consent: [] };
    await expect(run(lying)).rejects.toMatchObject({ code: "RECEIVER_CONSENT_REQUIRED" });
    expect(await balance(addresses.vault)).toBe(vault0);
  });

  it("the program's hard cap still applies to a validly signed request, reported with its PULSO code", async () => {
    const vault0 = await balance(addresses.vault);
    const err = await run(await pkgFor(usdc(600), nonceOf(5))).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PulsoProgramError);
    expect((err as PulsoProgramError).error.message).toBe("PULSO_008_AMOUNT_EXCEEDS_LIMIT");
    expect(await balance(addresses.vault)).toBe(vault0);
  });
});
