import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection, Keypair } from "@solana/web3.js";
import { buildIntent, PROGRAM_ID, type PendingApproval } from "@pulso/sdk";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Config } from "../src/config.js";
import { loadRecord, makeRecord, saveRecord } from "../src/store.js";

let directory: string;
let config: Config;
let pending: PendingApproval;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "pulso-mcp-store-"));
  await chmod(directory, 0o700);
  const authority = Keypair.generate().publicKey;
  const agent = Keypair.generate();
  const mint = Keypair.generate().publicKey;
  config = {
    connection: new Connection("http://127.0.0.1:8998"), network: "localnet", genesisHash: "genesis-A",
    authority, agent, mint, stateDir: directory, approvalsUrl: "http://127.0.0.1:3000",
    requestLifetimeSeconds: 120, maxLifetimeSeconds: 300,
  };
  const intent = buildIntent({ programId: PROGRAM_ID, authority, agent: agent.publicKey, mint,
    amount: 100n, recipient: Keypair.generate().publicKey, expiresAt: 1120n, maxUses: 1 });
  const approvalId = Buffer.from(intent.actionHash).toString("hex");
  pending = { status: "HUMAN_INTENT_REQUIRED", reason: "HUMAN_INTENT_REQUIRED", intent, approvalId,
    approvalUrl: `http://127.0.0.1:3000/approvals/${approvalId}` };
});

afterEach(async () => { await rm(directory, { recursive: true, force: true }); });

test("stores exact pending request atomically and reconstructs it after restart", async () => {
  const record = makeRecord(config, pending, 1000n);
  await saveRecord(config, record);
  const { record: restored, pending: loaded } = await loadRecord(config, pending.approvalId);
  expect(restored).toEqual(record);
  expect(loaded.intent.actionHash).toEqual(pending.intent.actionHash);
  expect(loaded.intent.fields.recipient.equals(pending.intent.fields.recipient)).toBe(true);
  expect(Buffer.from(loaded.intent.nonce).toString("hex")).toBe(Buffer.from(pending.intent.nonce).toString("hex"));
  await expect(saveRecord(config, record)).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
});

test("rejects different genesis, endpoint, amount tamper and loose file permissions", async () => {
  const record = makeRecord(config, pending, 1000n);
  await saveRecord(config, record);
  await expect(loadRecord({ ...config, genesisHash: "genesis-B" }, pending.approvalId))
    .rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  await expect(loadRecord({ ...config, connection: new Connection("http://127.0.0.1:8997") }, pending.approvalId))
    .rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  await expect(loadRecord({ ...config, authority: Keypair.generate().publicKey }, pending.approvalId))
    .rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  const path = join(directory, `${pending.approvalId}.json`);
  const raw = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
  await writeFile(path, JSON.stringify({ ...raw, amount: "101" }), { mode: 0o600 });
  await expect(loadRecord(config, pending.approvalId)).rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  await writeFile(path, JSON.stringify({ ...raw, approvalUrl: "http://127.0.0.1:3001/approvals/changed" }), { mode: 0o600 });
  await expect(loadRecord(config, pending.approvalId)).rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  for (const [field, value] of Object.entries({
    nonce: "00".repeat(16), recipientTokenAccount: Keypair.generate().publicKey.toBase58(),
    actionHash: "00".repeat(32), authority: Keypair.generate().publicKey.toBase58(),
    agent: Keypair.generate().publicKey.toBase58(), policy: Keypair.generate().publicKey.toBase58(),
    mint: Keypair.generate().publicKey.toBase58(),
  })) {
    await writeFile(path, JSON.stringify({ ...raw, [field]: value }), { mode: 0o600 });
    await expect(loadRecord(config, pending.approvalId), field)
      .rejects.toMatchObject({ code: "APPROVAL_CONTEXT_MISMATCH" });
  }
  await writeFile(path, JSON.stringify(raw), { mode: 0o600 });
  await chmod(path, 0o644);
  await expect(loadRecord(config, pending.approvalId)).rejects.toMatchObject({ code: "STATE_UNAVAILABLE" });
});

test("rejects pending expiry outside operator bound", () => {
  pending.intent.fields.expiresAt = 1400n;
  expect(() => makeRecord(config, pending, 1000n)).toThrow();
});
