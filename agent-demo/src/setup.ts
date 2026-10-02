import anchor from "@anchor-lang/core";
import { PROGRAM_ID, findPolicyPda, findVaultPda, getProgram } from "@pulso/sdk";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, TokenAccountNotFoundError } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";

const { BN } = anchor;

export type Cluster = "localnet" | "devnet";

export const DECIMALS = 6;
/** Whole USDC to base units. */
export const usdc = (n: number | bigint) => BigInt(n) * 10n ** BigInt(DECIMALS);

// Demo policy: the agent acts alone up to 10 USDC, never more than 500 per transaction or 1000 per day.
export const APPROVAL_THRESHOLD = usdc(10);
export const MAX_PER_TRANSACTION = usdc(500);
export const DAILY_LIMIT = usdc(1000);
export const VAULT_FUNDING = usdc(500);

export const RPC_URLS: Record<Cluster, string> = {
  localnet: "http://127.0.0.1:8899",
  devnet: "https://api.devnet.solana.com",
};

export interface DemoAddresses {
  cluster: Cluster;
  rpcUrl: string;
  programId: string;
  human: string;
  agent: string;
  merchant: string;
  mint: string;
  policy: string;
  vault: string;
  merchantTokenAccount: string;
  decimals: number;
}

const demoDir = (cluster: Cluster) => resolve(import.meta.dirname, "../../.demo", cluster);

/** The file the app and the agent read. */
export function loadAddresses(cluster: Cluster): DemoAddresses {
  const file = join(demoDir(cluster), "addresses.json");
  if (!existsSync(file)) throw new Error(`${file} not found. Run: pnpm --filter @pulso/agent-demo setup -- --cluster ${cluster}`);
  return JSON.parse(readFileSync(file, "utf8")) as DemoAddresses;
}

/** Demo keys have no value: they live in the gitignored .demo/ directory. */
export function loadKeypair(cluster: Cluster, name: "human" | "agent" | "merchant" | "mint"): Keypair {
  const file = join(demoDir(cluster), `${name}.json`);
  if (existsSync(file)) return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  mkdirSync(demoDir(cluster), { recursive: true });
  const kp = Keypair.generate();
  writeFileSync(file, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

async function ensureSol(connection: Connection, cluster: Cluster, to: PublicKey, minSol: number) {
  const min = minSol * LAMPORTS_PER_SOL;
  const have = await connection.getBalance(to);
  if (have >= min) return;
  if (cluster === "localnet") {
    await connection.confirmTransaction(await connection.requestAirdrop(to, 10 * LAMPORTS_PER_SOL));
    return;
  }
  // devnet: the airdrop is rate limited, so fund from the developer wallet instead.
  const file = join(homedir(), ".config/solana/id.json");
  if (!existsSync(file)) throw new Error(`devnet needs a funder wallet at ${file} with some SOL`);
  const funder = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(file, "utf8"))));
  const need = min - have;
  const funderBalance = await connection.getBalance(funder.publicKey);
  if (funderBalance < need + 5_000) {
    throw new Error(`Funder ${funder.publicKey.toBase58()} has ${funderBalance / LAMPORTS_PER_SOL} SOL on devnet; need ${need / LAMPORTS_PER_SOL} more. Fund it and run setup again.`);
  }
  const tx = new Transaction().add(SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports: need }));
  await sendAndConfirmTransaction(connection, tx, [funder]);
}

/** Idempotent: reuses whatever already exists on disk and on-chain, and only creates or tops up the difference. */
export async function setup(o: { cluster?: Cluster; rpcUrl?: string; log?: (m: string) => void } = {}): Promise<DemoAddresses> {
  const cluster = o.cluster ?? "localnet";
  const rpcUrl = o.rpcUrl ?? RPC_URLS[cluster];
  const log = o.log ?? (() => {});
  const connection = new Connection(rpcUrl, "confirmed");
  try {
    await connection.getVersion();
  } catch {
    throw new Error(`No validator answering at ${rpcUrl}${cluster === "localnet" ? " (start one, or use `pnpm demo`)" : ""}`);
  }
  if (!(await connection.getAccountInfo(PROGRAM_ID))) throw new Error(`Program ${PROGRAM_ID.toBase58()} is not deployed on ${cluster}`);

  const human = loadKeypair(cluster, "human");
  const agent = loadKeypair(cluster, "agent");
  const merchant = loadKeypair(cluster, "merchant");
  const mintKey = loadKeypair(cluster, "mint");

  await ensureSol(connection, cluster, human.publicKey, cluster === "devnet" ? 0.1 : 1);
  await ensureSol(connection, cluster, agent.publicKey, cluster === "devnet" ? 0.05 : 1);
  log("fees: ok");

  const mint = mintKey.publicKey;
  if (!(await connection.getAccountInfo(mint))) {
    await createMint(connection, human, human.publicKey, null, DECIMALS, mintKey);
    log(`mint created: ${mint.toBase58()}`);
  }

  const policy = findPolicyPda(human.publicKey, agent.publicKey);
  const vault = findVaultPda(policy);
  const program = getProgram(connection, human);
  if (!(await connection.getAccountInfo(policy))) {
    await program.methods
      .createPolicy(new BN(MAX_PER_TRANSACTION.toString()), new BN(DAILY_LIMIT.toString()), false, new BN(APPROVAL_THRESHOLD.toString()))
      .accountsPartial({ human: human.publicKey, agent: agent.publicKey })
      .rpc();
    log("policy created");
  }
  if (!(await connection.getAccountInfo(vault))) {
    await program.methods.createVault().accountsPartial({ human: human.publicKey, policy, mint }).rpc();
    log("vault created");
  }

  const current = await getAccount(connection, vault).then(
    (a) => a.amount,
    (e) => {
      if (e instanceof TokenAccountNotFoundError) return 0n;
      throw e;
    },
  );
  if (current < VAULT_FUNDING) {
    await mintTo(connection, human, mint, vault, human, VAULT_FUNDING - current);
    log(`vault funded with ${(VAULT_FUNDING - current) / usdc(1)} USDC`);
  }

  const merchantTa = await getOrCreateAssociatedTokenAccount(connection, human, mint, merchant.publicKey);

  const addresses: DemoAddresses = {
    cluster,
    rpcUrl,
    programId: PROGRAM_ID.toBase58(),
    human: human.publicKey.toBase58(),
    agent: agent.publicKey.toBase58(),
    merchant: merchant.publicKey.toBase58(),
    mint: mint.toBase58(),
    policy: policy.toBase58(),
    vault: vault.toBase58(),
    merchantTokenAccount: merchantTa.address.toBase58(),
    decimals: DECIMALS,
  };
  writeFileSync(join(demoDir(cluster), "addresses.json"), JSON.stringify(addresses, null, 2) + "\n");
  return addresses;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({ args: process.argv.slice(2).filter((a) => a !== "--"), options: { cluster: { type: "string", default: "localnet" } } });
  const cluster = values.cluster as Cluster;
  if (cluster !== "localnet" && cluster !== "devnet") {
    console.error("--cluster must be localnet or devnet");
    process.exit(1);
  }
  setup({ cluster, log: (m) => console.log(`setup: ${m}`) })
    .then((a) => console.log(`setup: done. Addresses in .demo/${cluster}/addresses.json\n${JSON.stringify(a, null, 2)}`))
    .catch((e: Error) => {
      console.error(`setup failed: ${e.message}`);
      process.exit(1);
    });
}
