import { lstat, mkdir, readFile, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";

// Solana's published cluster genesis hashes. Remote devnet is also checked against the live canonical RPC.
const MAINNET_GENESIS = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
const TESTNET_GENESIS = "4uhcVJyU9pJkvQyS88uRDiswHXSCkY3zQawwpjk2NsNY";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const outsideRepo = (path: string) => {
  const rel = relative(repoRoot, path);
  return rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
};

export class ConfigError extends Error {}

export interface Config {
  connection: Connection;
  network: "devnet" | "localnet";
  genesisHash: string;
  authority: PublicKey;
  agent: Keypair;
  mint: PublicKey;
  stateDir: string;
  approvalsUrl: string;
  requestLifetimeSeconds: number;
  maxLifetimeSeconds: number;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new ConfigError(`${name} is required`);
  return value;
}

function publicKey(env: NodeJS.ProcessEnv, name: string): PublicKey {
  try { return new PublicKey(required(env, name)); }
  catch { throw new ConfigError(`${name} must be a public key`); }
}

function url(env: NodeJS.ProcessEnv, name: string): URL {
  let parsed: URL;
  try { parsed = new URL(required(env, name)); }
  catch { throw new ConfigError(`${name} must be a URL`); }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password) {
    throw new ConfigError(`${name} must be an HTTP URL without embedded credentials`);
  }
  return parsed;
}

function positiveSeconds(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) throw new ConfigError(`${name} must be a positive integer`);
  return value;
}

export async function loadConfig(
  env: NodeJS.ProcessEnv = process.env,
  genesisOf: (connection: Connection) => Promise<string> = (connection) => connection.getGenesisHash(),
): Promise<Config> {
  const network = required(env, "PULSO_NETWORK");
  if (network !== "devnet" && network !== "localnet") throw new ConfigError("PULSO_NETWORK must be devnet or localnet");
  const rpc = url(env, "PULSO_RPC_URL");
  const approvals = url(env, "PULSO_APPROVALS_URL");
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(rpc.hostname);
  if (network === "localnet" && !loopback) throw new ConfigError("PULSO_RPC_URL must be loopback for localnet");
  if (network === "devnet" && rpc.protocol !== "https:") throw new ConfigError("PULSO_RPC_URL must use HTTPS for devnet");
  if (!["localhost", "127.0.0.1", "[::1]"].includes(approvals.hostname)) {
    throw new ConfigError("PULSO_APPROVALS_URL must be loopback in the local MVP");
  }
  const authority = publicKey(env, "PULSO_AUTHORITY");
  const mint = publicKey(env, "PULSO_MINT");
  const requestLifetimeSeconds = positiveSeconds(env, "PULSO_REQUEST_LIFETIME_SECONDS", 120);
  const maxLifetimeSeconds = positiveSeconds(env, "PULSO_MAX_LIFETIME_SECONDS", 300);
  if (requestLifetimeSeconds >= maxLifetimeSeconds) throw new ConfigError("request lifetime must be below maximum lifetime");

  const keyPath = required(env, "PULSO_AGENT_KEYPAIR");
  if (!isAbsolute(keyPath)) throw new ConfigError("PULSO_AGENT_KEYPAIR must be an absolute path outside the repository");
  let agent: Keypair;
  try {
    const resolved = await realpath(keyPath);
    if (!outsideRepo(resolved)) {
      throw new ConfigError("PULSO_AGENT_KEYPAIR must resolve outside the repository");
    }
    const bytes: unknown = JSON.parse(await readFile(resolved, "utf8"));
    if (!Array.isArray(bytes) || bytes.length !== 64 || !bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) {
      throw new ConfigError("invalid keypair");
    }
    agent = Keypair.fromSecretKey(Uint8Array.from(bytes));
  } catch (error) {
    if (error instanceof Error && error.message.includes("must resolve outside")) throw error;
    throw new ConfigError("PULSO_AGENT_KEYPAIR could not be loaded");
  }
  if (agent.publicKey.equals(authority)) throw new ConfigError("PULSO_AGENT_KEYPAIR must differ from PULSO_AUTHORITY");

  const statePath = required(env, "PULSO_STATE_DIR");
  if (!isAbsolute(statePath)) throw new ConfigError("PULSO_STATE_DIR must be an absolute path outside the repository");
  if (!outsideRepo(resolve(statePath))) throw new ConfigError("PULSO_STATE_DIR must resolve outside the repository");
  let stateDir: string;
  try {
    await mkdir(statePath, { recursive: true, mode: 0o700 });
    if ((await lstat(statePath)).isSymbolicLink()) throw new ConfigError("PULSO_STATE_DIR must not be a symlink");
    stateDir = await realpath(statePath);
    if (!outsideRepo(stateDir)) throw new ConfigError("PULSO_STATE_DIR must resolve outside the repository");
    const details = await stat(stateDir);
    if ((details.mode & 0o077) !== 0 || (process.getuid && details.uid !== process.getuid())) {
      throw new ConfigError("PULSO_STATE_DIR must be owned by this user with mode 0700");
    }
  } catch (error) {
    if (error instanceof ConfigError) throw error;
    throw new ConfigError("PULSO_STATE_DIR could not be prepared");
  }

  const connection = new Connection(rpc.toString(), "confirmed");
  let genesisHash: string;
  try {
    genesisHash = await genesisOf(connection);
    if (network === "devnet") {
      const canonical = await genesisOf(new Connection("https://api.devnet.solana.com", "confirmed"));
      if (genesisHash !== canonical) throw new ConfigError("network mismatch");
    } else if (genesisHash === MAINNET_GENESIS || genesisHash === TESTNET_GENESIS) {
      throw new ConfigError("network mismatch");
    }
  } catch {
    throw new ConfigError("PULSO_RPC_URL is unavailable or is not the configured network");
  }

  return { connection, network, genesisHash, authority, agent, mint, stateDir, approvalsUrl: approvals.toString().replace(/\/+$/, ""), requestLifetimeSeconds, maxLifetimeSeconds };
}
