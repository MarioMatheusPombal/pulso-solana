import { createServer as createHttpServer, type Server } from "node:http";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { Keypair } from "@solana/web3.js";
import { afterAll, beforeAll, expect, test } from "vitest";
import { loadConfig, type Config } from "../src/config.js";
import { payReceiptChallenge } from "../src/transfer.js";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const genesis = "LocalGenesisForMcpTests";
let directory: string;
let keyPath: string;
let rpc: Server;
let rpcUrl: string;
let baseEnv: NodeJS.ProcessEnv;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "pulso-mcp-test-"));
  keyPath = join(directory, "agent.json");
  await writeFile(keyPath, JSON.stringify(Array.from(Keypair.generate().secretKey)), { mode: 0o600 });
  rpc = createHttpServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const input = JSON.parse(Buffer.concat(chunks).toString()) as { id: number; method: string };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: input.id, result: genesis }));
  });
  rpc.listen(0, "127.0.0.1");
  await once(rpc, "listening");
  const address = rpc.address();
  if (!address || typeof address === "string") throw new Error("No test RPC port");
  rpcUrl = `http://127.0.0.1:${address.port}`;
  baseEnv = {
    PULSO_NETWORK: "localnet", PULSO_RPC_URL: rpcUrl,
    PULSO_APPROVALS_URL: "http://127.0.0.1:3000",
    PULSO_AUTHORITY: Keypair.generate().publicKey.toBase58(),
    PULSO_MINT: Keypair.generate().publicKey.toBase58(),
    PULSO_AGENT_KEYPAIR: keyPath,
    PULSO_STATE_DIR: join(directory, "state"),
  };
});

afterAll(async () => {
  if (rpc) await new Promise<void>((resolve, reject) => rpc.close((error) => error ? reject(error) : resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("config accepts localnet and rejects mainnet through a loopback RPC", async () => {
  const config = await loadConfig(baseEnv, async () => genesis);
  expect(config.network).toBe("localnet");
  expect(config.agent.publicKey).toBeTruthy();
  expect(config.requestLifetimeSeconds).toBe(120);
  expect(config.maxLifetimeSeconds).toBe(300);
  expect(config.stateDir).toBe(await realpath(join(directory, "state")));
  await expect(loadConfig(baseEnv, async () => "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d")).rejects.toThrow("not the configured network");
  await expect(loadConfig({ ...baseEnv, PULSO_NETWORK: "mainnet" })).rejects.toThrow("devnet or localnet");
  await expect(loadConfig({ ...baseEnv, PULSO_MAX_LIFETIME_SECONDS: "120" })).rejects.toThrow("below maximum");
});

test("agent signer cannot also be the human authority", async () => {
  const agent = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(await readFile(keyPath, "utf8")) as number[]));
  await expect(loadConfig({ ...baseEnv, PULSO_AUTHORITY: agent.publicKey.toBase58() }, async () => genesis))
    .rejects.toThrow("must differ from PULSO_AUTHORITY");
});

test("signer must resolve outside repository, including symlinks", async () => {
  const link = join(directory, "linked-inside.json");
  await symlink(join(packageRoot, "package.json"), link);
  try {
    await expect(loadConfig({ ...baseEnv, PULSO_AGENT_KEYPAIR: link }, async () => genesis)).rejects.toThrow("outside the repository");
  } finally {
    await rm(link);
  }
});

test("paths starting with two dots inside repository are still rejected", async () => {
  const key = join(packageRoot, "..agent.json");
  const state = join(packageRoot, "..state");
  await writeFile(key, await readFile(keyPath));
  await mkdir(state, { mode: 0o700 });
  try {
    await expect(loadConfig({ ...baseEnv, PULSO_AGENT_KEYPAIR: key }, async () => genesis))
      .rejects.toThrow("outside the repository");
    await expect(loadConfig({ ...baseEnv, PULSO_STATE_DIR: state }, async () => genesis))
      .rejects.toThrow("outside the repository");
  } finally {
    await rm(key);
    await rm(state, { recursive: true });
  }
});

test("real MCP client negotiates 2026-07-28, lists only five tools and reports unavailable RPC", async () => {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["--import", "tsx", "dist/index.js"],
    cwd: packageRoot,
    env: { ...process.env, ...baseEnv } as Record<string, string>,
    stderr: "pipe",
  });
  const client = new Client({ name: "pulso-test", version: "0.0.0" }, { versionNegotiation: { mode: { pin: "2026-07-28" } } });
  const errors: string[] = [];
  transport.stderr?.on("data", (chunk: Buffer) => errors.push(chunk.toString()));
  try {
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    const listed = await client.listTools();
    expect(listed.tools.map((tool) => tool.name)).toEqual(["get_policy", "request_transfer", "pay_receipt_challenge", "get_approval_status", "execute_approved"]);
    const smoke = await client.callTool({ name: "get_policy", arguments: {} });
    expect(smoke.isError).toBe(true);
    expect(JSON.stringify(smoke.content)).toContain("RPC_UNAVAILABLE");
    const override = await client.callTool({ name: "get_policy", arguments: { authority: baseEnv.PULSO_AUTHORITY } });
    expect(override.isError).toBe(true);
    expect(JSON.stringify(override.content)).not.toContain("RPC_UNAVAILABLE");
    const recipientTokenAccount = Keypair.generate().publicKey.toBase58();
    const valid = { amount: "1", recipientTokenAccount };
    for (const arguments_ of [
      { ...valid, authority: baseEnv.PULSO_AUTHORITY }, { ...valid, agent: baseEnv.PULSO_AUTHORITY },
      { ...valid, nonce: "0".repeat(32) }, { ...valid, expiresAt: "9999999999" },
      { ...valid, rpc: rpcUrl }, { ...valid, maxUses: 2 },
      { ...valid, amount: 1 }, { ...valid, amount: "0" }, { ...valid, amount: "1e6" },
      { ...valid, amount: "-1" }, { ...valid, amount: "18446744073709551616" },
    ]) {
      const rejected = await client.callTool({ name: "request_transfer", arguments: arguments_ });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.content)).not.toContain("RPC_UNAVAILABLE");
    }
    const challenge = { scheme: "pulso-receipt-v1", programId: Keypair.generate().publicKey.toBase58(), recipient: recipientTokenAccount,
      mint: baseEnv.PULSO_MINT, minAmount: "1", nonce: "0".repeat(32), expiresAt: 9999999999 };
    for (const arguments_ of [{ ...challenge, url: "http://receiver/resource" }, { ...challenge, amount: "1" },
      { ...challenge, scheme: "other" }, { ...challenge, nonce: "0".repeat(31) }, { ...challenge, minAmount: "0" }]) {
      const rejected = await client.callTool({ name: "pay_receipt_challenge", arguments: arguments_ });
      expect(rejected.isError).toBe(true);
      expect(JSON.stringify(rejected.content)).not.toContain("RPC_UNAVAILABLE");
    }
    expect(errors.join("")).toContain("PULSO MCP listening on stdio");
  } finally {
    await client.close();
  }
});

test("challenge validation fails closed with its own code before touching the chain", async () => {
  const mint = Keypair.generate().publicKey;
  const config = { mint } as Config; // no connection: any chain access would throw a different error
  const ok = { scheme: "pulso-receipt-v1", programId: "", recipient: "x", mint: mint.toBase58(), minAmount: "1", nonce: "0".repeat(32), expiresAt: 9999999999 };
  const { PROGRAM_ID } = await import("@pulso/sdk");
  ok.programId = PROGRAM_ID.toBase58();
  const cases: [Partial<typeof ok>, string][] = [
    [{ scheme: "other" }, "CHALLENGE_INVALID"], [{ nonce: "AB".repeat(16) }, "CHALLENGE_INVALID"],
    [{ minAmount: "0" }, "CHALLENGE_INVALID"], [{ minAmount: "18446744073709551616" }, "CHALLENGE_INVALID"],
    [{ expiresAt: 0 }, "CHALLENGE_INVALID"],
    [{ programId: Keypair.generate().publicKey.toBase58() }, "CHALLENGE_CONTEXT_MISMATCH"],
    [{ mint: Keypair.generate().publicKey.toBase58() }, "CHALLENGE_CONTEXT_MISMATCH"],
  ];
  for (const [override, code] of cases) {
    await expect(payReceiptChallenge(config, { ...ok, ...override })).rejects.toMatchObject({ code });
  }
});

test.each(["SIGTERM", "EOF"] as const)("%s shuts down cleanly and stdout contains no diagnostic text", async (mode) => {
  const child = spawn(process.execPath, ["--import", "tsx", "dist/index.js"], {
    cwd: packageRoot, env: { ...process.env, ...baseEnv }, stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("server did not start")), 5_000);
    child.stderr.on("data", (part: Buffer) => {
      if (part.toString().includes("PULSO MCP listening on stdio")) { clearTimeout(timer); resolve(); }
    });
    child.once("error", reject);
  });
  if (mode === "EOF") child.stdin.end();
  else child.kill("SIGTERM");
  const [code, signal] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
  expect(code).toBe(0);
  expect(signal).toBeNull();
  expect(stdout).toBe("");
});

test("startup failure is legible and does not print URL credentials", async () => {
  const child = spawn(process.execPath, ["--import", "tsx", "dist/index.js"], {
    cwd: packageRoot,
    env: { ...process.env, ...baseEnv, PULSO_RPC_URL: "http://secret-user:secret-pass@127.0.0.1:8899" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (part: Buffer) => { stderr += part.toString(); });
  child.stdout.on("data", (part: Buffer) => { stdout += part.toString(); });
  const [code] = await once(child, "exit") as [number];
  expect(code).toBe(1);
  expect(stderr).toContain("PULSO_RPC_URL must be an HTTP URL without embedded credentials");
  expect(stderr).not.toContain("secret-user");
  expect(stderr).not.toContain("secret-pass");
  expect(stdout).toBe("");
});
