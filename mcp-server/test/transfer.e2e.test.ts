import { createServer, type Server } from "node:http";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BN } from "@anchor-lang/core";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, findIntentPda, findPolicyPda, findVaultPda, getProgram } from "@pulso/sdk";
import { afterAll, beforeAll, expect, test } from "vitest";
import { startValidator, type LocalValidator } from "../../agent-demo/src/validator.js";
import type { Config } from "../src/config.js";
import { executeApproved, getApprovalStatus } from "../src/approval.js";
import { loadRecord } from "../src/store.js";
import { getPolicy, payReceiptChallenge, requestTransfer } from "../src/transfer.js";
import { startReceiver } from "../../agent-demo/src/receiver.js";

const T = (n: number) => BigInt(n) * 1_000_000n;
const human = Keypair.generate(); // localnet fixture only; never leaves this test process
const agent = Keypair.generate();
let validator: LocalValidator;
let backend: Server;
let backendUrl: string;
let directory: string;
let config: Config;
let recipient: string;
let vault: PublicKey;
let backendStatus = 201;
let backendHint: unknown = "approved";
let backendGetStatus = 200;
let posted: unknown[] = [];

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "pulso-mcp-e2e-"));
  validator = await startValidator({ programId: PROGRAM_ID.toBase58(),
    soPath: resolve(import.meta.dirname, "../../target/deploy/pulso.so"), rpcPort: 8998, faucetPort: 9998 });
  const connection = validator.connection;
  for (const signer of [human, agent]) {
    await connection.confirmTransaction(await connection.requestAirdrop(signer.publicKey, 10 * LAMPORTS_PER_SOL));
  }
  const mint = await createMint(connection, human, human.publicKey, null, 6);
  recipient = (await getOrCreateAssociatedTokenAccount(connection, human, mint, Keypair.generate().publicKey)).address.toBase58();
  backend = createServer(async (req, res) => {
    if (req.method === "GET" && req.url?.startsWith("/api/approvals/")) {
      res.writeHead(backendGetStatus, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: backendHint }));
      return;
    }
    let text = "";
    for await (const chunk of req) text += chunk.toString();
    if (text) posted.push(JSON.parse(text));
    res.writeHead(backendStatus, { "content-type": "application/json" });
    res.end(backendStatus === 201 ? "{}" : "secret backend details");
  });
  backend.listen(0, "127.0.0.1");
  await once(backend, "listening");
  const address = backend.address();
  if (!address || typeof address === "string") throw new Error("backend port missing");
  backendUrl = `http://127.0.0.1:${address.port}`;
  config = { connection, network: "localnet", genesisHash: await connection.getGenesisHash(),
    authority: human.publicKey, agent, mint, stateDir: directory, approvalsUrl: backendUrl,
    requestLifetimeSeconds: 120, maxLifetimeSeconds: 300 };
});

afterAll(async () => {
  if (backend) await new Promise<void>((resolve, reject) => backend.close((error) => error ? reject(error) : resolve()));
  await validator?.stop();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("get_policy distinguishes missing policy from RPC and validates on-chain policy/vault", async () => {
  await expect(getPolicy(config)).rejects.toMatchObject({ code: "POLICY_NOT_FOUND" });
  const connection = config.connection;
  const policy = findPolicyPda(human.publicKey, agent.publicKey);
  vault = findVaultPda(policy);
  const program = getProgram(connection, human);
  await program.methods.createPolicy(new BN(T(500).toString()), new BN(T(1000).toString()), false,
    new BN(T(10).toString())).accountsPartial({ human: human.publicKey, agent: agent.publicKey }).rpc();
  await program.methods.createVault().accountsPartial({ human: human.publicKey, policy, mint: config.mint }).rpc();
  await mintTo(connection, human, config.mint, vault, human, T(500));
  const found = await getPolicy(config);
  expect(found).toMatchObject({ status: "found", policy: policy.toBase58(), mint: config.mint.toBase58(),
    maxPerTransaction: T(500).toString(), dailyLimit: T(1000).toString(), requireApprovalAbove: T(10).toString() });
  await expect(getPolicy({ ...config, connection: new Connection("http://127.0.0.1:8997") })).rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
});

test("autonomous transfer confirms, pending stores exact payload; hard cap and invalid recipients fail", async () => {
  const vaultBefore = (await getAccount(config.connection, vault)).amount;
  const recipientBefore = (await getAccount(config.connection, new PublicKey(recipient))).amount;
  const autonomous = await requestTransfer(config, { amount: T(5).toString(), recipientTokenAccount: recipient });
  expect(autonomous.status).toBe("executed");
  if (autonomous.status !== "executed") throw new Error("not executed");
  expect(autonomous.signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]+$/);
  expect((await getAccount(config.connection, vault)).amount).toBe(vaultBefore - T(5));
  expect((await getAccount(config.connection, new PublicKey(recipient))).amount).toBe(recipientBefore + T(5));
  const vaultAfterAutonomous = (await getAccount(config.connection, vault)).amount;

  const pending = await requestTransfer(config, { amount: T(100).toString(), recipientTokenAccount: recipient });
  expect(pending.status).toBe("pending");
  if (pending.status !== "pending") throw new Error("not pending");
  expect(pending.reason).toBe("HUMAN_INTENT_REQUIRED");
  expect(pending.payload.actionHash).toBe(pending.approvalId);
  expect(pending.payload.recipientTokenAccount).toBe(recipient);
  expect(posted).toHaveLength(1);
  const restored = await loadRecord(config, pending.approvalId);
  expect(restored.pending.intent.fields.amount).toBe(T(100));
  expect(restored.pending.intent.fields.recipient.toBase58()).toBe(recipient);
  expect((await getAccount(config.connection, vault)).amount).toBe(vaultAfterAutonomous);

  await expect(requestTransfer(config, { amount: T(600).toString(), recipientTokenAccount: recipient }))
    .rejects.toMatchObject({ error: { message: "PULSO_008_AMOUNT_EXCEEDS_LIMIT" } });
  await expect(requestTransfer(config, { amount: "0", recipientTokenAccount: recipient }))
    .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(requestTransfer(config, { amount: "999999999999999999999999999999", recipientTokenAccount: recipient }))
    .rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  await expect(requestTransfer(config, { amount: "1", recipientTokenAccount: Keypair.generate().publicKey.toBase58() }))
    .rejects.toMatchObject({ code: "RECIPIENT_INVALID" });
  const otherMint = await createMint(config.connection, human, human.publicKey, null, 6);
  const wrongMintRecipient = (await getOrCreateAssociatedTokenAccount(config.connection, human, otherMint,
    Keypair.generate().publicKey)).address.toBase58();
  await expect(requestTransfer(config, { amount: "1", recipientTokenAccount: wrongMintRecipient }))
    .rejects.toMatchObject({ code: "RECIPIENT_INVALID" });
  expect((await getAccount(config.connection, vault)).amount).toBe(vaultAfterAutonomous);
});

test("backend failure does not return pending or leak response body", async () => {
  const vaultBefore = (await getAccount(config.connection, vault)).amount;
  backendStatus = 503;
  const error = await requestTransfer(config, { amount: T(100).toString(), recipientTokenAccount: recipient }).catch((e) => e);
  expect(error.code).toBe("BACKEND_UNAVAILABLE");
  expect(error.message).not.toContain("secret backend details");
  expect((await getAccount(config.connection, vault)).amount).toBe(vaultBefore);
  backendStatus = 201;
});

test("SDK clock fallback cannot create a pending approval when slot RPC fails", async () => {
  const postedBefore = posted.length;
  const connection = new Proxy(config.connection, {
    get(target, property) {
      if (property === "getSlot") return async () => { throw new Error("slot RPC failed"); };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(requestTransfer({ ...config, connection }, { amount: T(100).toString(), recipientTokenAccount: recipient }))
    .rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });
  expect(posted).toHaveLength(postedBefore);
});

test("MCP stdio resumes the exact request after restart and a retry cannot transfer twice", async () => {
  const keyPath = join(directory, "agent.json");
  await writeFile(keyPath, JSON.stringify(Array.from(agent.secretKey)), { mode: 0o600 });
  const env = {
    ...process.env, PULSO_NETWORK: "localnet", PULSO_RPC_URL: config.connection.rpcEndpoint,
    PULSO_APPROVALS_URL: backendUrl, PULSO_AUTHORITY: human.publicKey.toBase58(),
    PULSO_AGENT_KEYPAIR: keyPath, PULSO_STATE_DIR: directory, PULSO_MINT: config.mint.toBase58(),
  } as Record<string, string>;
  const connect = async () => {
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ["--import", "tsx", "dist/index.js"], cwd: resolve(import.meta.dirname, ".."), env, stderr: "pipe" });
    const client = new Client({ name: "pulso-resume-e2e", version: "0.0.0" },
      { versionNegotiation: { mode: { pin: "2026-07-28" } } });
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
    return client;
  };
  type Result = { status: string; approvalId: string; signature?: string; payload?: { expiresAt: string; maxUses: number } };
  const call = async (client: Client, name: string, args: Record<string, unknown>) =>
    client.callTool({ name, arguments: args });
  const vaultBefore = (await getAccount(config.connection, vault)).amount;
  const recipientBefore = (await getAccount(config.connection, new PublicKey(recipient))).amount;
  const amount = T(20);
  let client = await connect();
  let approvalId: string;
  let expiresAt: string;
  try {
    const requested = await call(client, "request_transfer", { amount: amount.toString(), recipientTokenAccount: recipient });
    expect(requested.isError).not.toBe(true);
    const pending = requested.structuredContent as Result;
    expect(pending.status).toBe("pending");
    approvalId = pending.approvalId;
    expiresAt = pending.payload!.expiresAt;
    const fakeApproved = await call(client, "get_approval_status", { approvalId });
    expect((fakeApproved.structuredContent as Result).status).toBe("pending");
    const statusOverride = await call(client, "get_approval_status", { approvalId, agent: agent.publicKey.toBase58() });
    expect(statusOverride.isError).toBe(true);
    const forbidden = await call(client, "execute_approved", { approvalId, amount: "1" });
    expect(forbidden.isError).toBe(true);
    const absent = await call(client, "execute_approved", { approvalId });
    expect(absent.isError).toBe(true);
    expect(JSON.stringify(absent.content)).toContain("APPROVAL_NOT_ON_CHAIN");
  } finally { await client.close(); }
  client = await connect(); // New server process, same private state directory.
  try {
    const restored = await call(client, "get_approval_status", { approvalId: approvalId! });
    expect((restored.structuredContent as Result).status).toBe("pending");
    const policy = findPolicyPda(human.publicKey, agent.publicKey);
    const hash = Buffer.from(approvalId!, "hex");
    await getProgram(config.connection, human).methods.recordIntent(Array.from(hash), new BN(expiresAt!), 1)
      .accountsPartial({ authority: human.publicKey, policy,
        intent: findIntentPda(human.publicKey, hash) }).rpc();
    const approved = await call(client, "get_approval_status", { approvalId: approvalId! });
    expect((approved.structuredContent as Result).status).toBe("approved");
    const [first, concurrent] = await Promise.all([
      call(client, "execute_approved", { approvalId: approvalId! }),
      call(client, "execute_approved", { approvalId: approvalId! }),
    ]);
    expect([first, concurrent].some((result) => (result.structuredContent as Result | undefined)?.status === "executed")).toBe(true);
    expect((await getAccount(config.connection, vault)).amount).toBe(vaultBefore - amount);
    expect((await getAccount(config.connection, new PublicKey(recipient))).amount).toBe(recipientBefore + amount);
    const used = await call(client, "get_approval_status", { approvalId: approvalId! });
    expect((used.structuredContent as Result).status).toBe("used");
    const retry = await call(client, "execute_approved", { approvalId: approvalId! });
    expect(retry.isError).toBe(true);
    expect(JSON.stringify(retry.content)).toContain("INTENT_ALREADY_USED");
    expect((await getAccount(config.connection, vault)).amount).toBe(vaultBefore - amount);
  } finally { await client.close(); }
});

test("revoked, mismatched, expired and RPC-failed intents fail closed", async () => {
  const program = getProgram(config.connection, human);
  const policy = findPolicyPda(human.publicKey, agent.publicKey);
  const vaultBefore = (await getAccount(config.connection, vault)).amount;
  const recipientBefore = (await getAccount(config.connection, new PublicKey(recipient))).amount;
  const createPending = async (amount: number, cfg = config) => {
    const result = await requestTransfer(cfg, { amount: T(amount).toString(), recipientTokenAccount: recipient });
    if (result.status !== "pending") throw new Error("expected pending approval");
    return result;
  };
  const revoked = await createPending(21);
  const revokedHash = Buffer.from(revoked.approvalId, "hex");
  const revokedPda = findIntentPda(human.publicKey, revokedHash);
  await program.methods.recordIntent(Array.from(revokedHash), new BN(revoked.payload.expiresAt), 1)
    .accountsPartial({ authority: human.publicKey, policy, intent: revokedPda }).rpc();
  await program.methods.revokeIntent().accountsPartial({ authority: human.publicKey, intent: revokedPda }).rpc();
  expect((await getApprovalStatus(config, revoked.approvalId)).status).toBe("revoked");
  await expect(executeApproved(config, revoked.approvalId)).rejects.toMatchObject({ code: "INTENT_REVOKED" });

  const mismatched = await createPending(22);
  const mismatchHash = Buffer.from(mismatched.approvalId, "hex");
  await program.methods.recordIntent(Array.from(mismatchHash), new BN(mismatched.payload.expiresAt), 2)
    .accountsPartial({ authority: human.publicKey, policy,
      intent: findIntentPda(human.publicKey, mismatchHash) }).rpc();
  await expect(getApprovalStatus(config, mismatched.approvalId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
  await expect(executeApproved(config, mismatched.approvalId)).rejects.toMatchObject({ code: "INTENT_MISMATCH" });

  const shortConfig = { ...config, requestLifetimeSeconds: 1 };
  const expiring = await createPending(23, shortConfig);
  await new Promise((resolve) => setTimeout(resolve, 3_000));
  expect((await getApprovalStatus(shortConfig, expiring.approvalId)).status).toBe("expired");
  await expect(executeApproved(shortConfig, expiring.approvalId)).rejects.toMatchObject({ code: "INTENT_EXPIRED" });

  const future = await createPending(24);
  const path = join(directory, `${future.approvalId}.json`);
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...raw, requestedAt: (BigInt(String(raw.requestedAt)) + 30n).toString() }), { mode: 0o600 });
  await expect(getApprovalStatus(config, future.approvalId)).rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });

  const unavailable = await createPending(25);
  const connection = new Proxy(config.connection, {
    get(target, property) {
      if (property === "getAccountInfo") return async () => { throw new Error("secret RPC response"); };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  await expect(getApprovalStatus({ ...config, connection }, unavailable.approvalId))
    .rejects.toMatchObject({ code: "RPC_UNAVAILABLE" });

  const denied = await createPending(26);
  backendHint = "denied";
  try {
    expect((await getApprovalStatus(config, denied.approvalId)).status).toBe("denied");
    await expect(executeApproved(config, denied.approvalId)).rejects.toMatchObject({ code: "APPROVAL_DENIED" });
  } finally { backendHint = "approved"; }
  backendGetStatus = 503;
  try {
    await expect(getApprovalStatus(config, denied.approvalId)).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  } finally { backendGetStatus = 200; }
  backendHint = ["approved"];
  try {
    await expect(getApprovalStatus(config, denied.approvalId)).rejects.toMatchObject({ code: "BACKEND_UNAVAILABLE" });
  } finally { backendHint = "approved"; }

  const paused = await createPending(27);
  await program.methods.updatePolicy(false, new BN(T(500).toString()), new BN(T(1000).toString()), false,
    new BN(T(10).toString())).accountsPartial({ authority: human.publicKey, policy }).rpc();
  try {
    expect((await getApprovalStatus(config, paused.approvalId)).status).toBe("revoked");
    await expect(executeApproved(config, paused.approvalId)).rejects.toMatchObject({ code: "INTENT_REVOKED" });
  } finally {
    await program.methods.updatePolicy(true, new BN(T(500).toString()), new BN(T(1000).toString()), false,
      new BN(T(10).toString())).accountsPartial({ authority: human.publicKey, policy }).rpc();
  }
  expect((await getAccount(config.connection, vault)).amount).toBe(vaultBefore);
  expect((await getAccount(config.connection, new PublicKey(recipient))).amount).toBe(recipientBefore);
});

test("pay_receipt_challenge pays a 402 challenge and the receiver accepts the receipt, never a replay", async () => {
  const receiver = await startReceiver({ connection: config.connection, recipient: new PublicKey(recipient), mint: config.mint,
    cluster: "localnet", resources: { "/resource": { price: T(5) }, "/resource/premium": { price: T(100), requireApproved: true } } });
  const get = async (path: string, proof?: { signature: string; nonce: string }) => {
    const res = await fetch(`${receiver.url}${path}`, { headers: proof ? { "X-PULSO-Receipt": proof.signature, "X-PULSO-Challenge": proof.nonce } : {} });
    return { status: res.status, body: (await res.json()) as Record<string, any> };
  };
  const vaultAmount = async () => (await getAccount(config.connection, vault)).amount;
  try {
    // (a) autonomous
    const c1 = (await get("/resource")).body as Parameters<typeof payReceiptChallenge>[1];
    const paid = await payReceiptChallenge(config, c1);
    if (paid.status !== "executed") throw new Error("expected executed");
    expect(paid.challengeNonce).toBe(c1.nonce);
    const r1 = await get("/resource", { signature: paid.signature, nonce: c1.nonce });
    expect(r1.status).toBe(200);
    expect(r1.body.receipt.mode).toBe("autonomous");

    // (b) approved
    const c2 = (await get("/resource/premium")).body as Parameters<typeof payReceiptChallenge>[1];
    const pending = await payReceiptChallenge(config, c2);
    if (pending.status !== "pending") throw new Error("expected pending");
    expect(pending.payload.nonce).toBe(c2.nonce);
    expect(pending.payload.amount).toBe(c2.minAmount);
    expect(Number(pending.payload.expiresAt)).toBeLessThanOrEqual(c2.expiresAt - 5);
    const hash = Buffer.from(pending.approvalId, "hex");
    await getProgram(config.connection, human).methods.recordIntent(Array.from(hash), new BN(pending.payload.expiresAt), 1)
      .accountsPartial({ authority: human.publicKey, policy: findPolicyPda(human.publicKey, agent.publicKey),
        intent: findIntentPda(human.publicKey, hash) }).rpc();
    const resumed = await executeApproved(config, pending.approvalId);
    const r2 = await get("/resource/premium", { signature: resumed.signature, nonce: c2.nonce });
    expect(r2.status).toBe(200);
    expect(r2.body.receipt).toMatchObject({ mode: "approved", hashVerified: true });

    // (c) tampered challenges pay nothing
    const before = await vaultAmount();
    const c3 = (await get("/resource")).body as Parameters<typeof payReceiptChallenge>[1];
    const otherMint = await createMint(config.connection, human, human.publicKey, null, 6);
    for (const [override, code] of [
      [{ mint: otherMint.toBase58() }, "CHALLENGE_CONTEXT_MISMATCH"],
      [{ programId: Keypair.generate().publicKey.toBase58() }, "CHALLENGE_CONTEXT_MISMATCH"],
      [{ expiresAt: 1 }, "CHALLENGE_EXPIRED"],
      [{ expiresAt: Math.floor(Date.now() / 1000) + 3 }, "CHALLENGE_EXPIRED"],
    ] as const) {
      await expect(payReceiptChallenge(config, { ...c3, ...override })).rejects.toMatchObject({ code });
    }
    expect(await vaultAmount()).toBe(before);

    // (d) the receipt from (a) does not unlock a new challenge, and the tool has no shortcut for it
    const c4 = (await get("/resource")).body as Parameters<typeof payReceiptChallenge>[1];
    const replay = await get("/resource", { signature: paid.signature, nonce: c4.nonce });
    expect(replay.status).toBe(402);
    expect(replay.body.reason).toBe("NONCE_MISMATCH");
  } finally { await receiver.close(); }
});
