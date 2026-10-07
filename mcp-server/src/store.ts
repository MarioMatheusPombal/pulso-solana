import { createHash, randomUUID } from "node:crypto";
import { link, lstat, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { PublicKey } from "@solana/web3.js";
import { buildIntent, findPolicyPda, findVaultPda, PROGRAM_ID, type PendingApproval } from "@pulso/sdk";
import * as z from "zod/v4";
import type { Config } from "./config.js";

const hash = z.string().regex(/^[0-9a-f]{64}$/);
const address = z.string().min(32).max(44);
const positive = z.string().regex(/^[1-9][0-9]{0,19}$/);
const seconds = z.string().regex(/^[1-9][0-9]{0,18}$/);
const recordSchema = z.strictObject({
  approvalId: hash,
  reason: z.enum(["HUMAN_INTENT_REQUIRED", "RECIPIENT_NOT_ALLOWED"]),
  approvalUrl: z.url(),
  requestedAt: seconds,
  requestLifetimeSeconds: z.number().int().positive(),
  maxLifetimeSeconds: z.number().int().positive(),
  endpointFingerprint: hash,
  genesisHash: z.string().min(1),
  programId: address,
  policy: address,
  vault: address,
  authority: address,
  agent: address,
  mint: address,
  instruction: z.literal(1),
  amount: positive,
  recipientTokenAccount: address,
  nonce: z.string().regex(/^[0-9a-f]{32}$/),
  expiresAt: seconds,
  maxUses: z.literal(1),
  actionHash: hash,
});

export type StoredApproval = z.infer<typeof recordSchema>;
export class StateError extends Error {
  constructor(readonly code: "STATE_UNAVAILABLE" | "APPROVAL_NOT_FOUND" | "APPROVAL_CONTEXT_MISMATCH") {
    super(code);
  }
}

const fingerprint = (config: Config) => createHash("sha256").update(config.connection.rpcEndpoint).digest("hex");
const pathFor = (config: Config, approvalId: string) => join(config.stateDir, `${approvalId}.json`);

async function privateDir(config: Config): Promise<void> {
  try {
    const details = await lstat(config.stateDir);
    if (!details.isDirectory() || (details.mode & 0o077) !== 0 ||
      (process.getuid && details.uid !== process.getuid())) throw new Error("unsafe state directory");
  } catch { throw new StateError("STATE_UNAVAILABLE"); }
}

export function makeRecord(config: Config, pending: PendingApproval, requestedAt: bigint): StoredApproval {
  const f = pending.intent.fields;
  const policy = findPolicyPda(config.authority, config.agent.publicKey, PROGRAM_ID);
  const vault = findVaultPda(policy, PROGRAM_ID);
  if (!pending.approvalUrl || f.expiresAt <= requestedAt || f.expiresAt - requestedAt > BigInt(config.maxLifetimeSeconds)) {
    throw new StateError("STATE_UNAVAILABLE");
  }
  const candidate = {
    approvalId: pending.approvalId, reason: pending.reason, approvalUrl: pending.approvalUrl,
    requestedAt: requestedAt.toString(), requestLifetimeSeconds: config.requestLifetimeSeconds,
    maxLifetimeSeconds: config.maxLifetimeSeconds, endpointFingerprint: fingerprint(config),
    genesisHash: config.genesisHash, programId: f.programId.toBase58(),
    policy: policy.toBase58(), vault: vault.toBase58(),
    authority: f.authority.toBase58(), agent: f.agent.toBase58(), mint: f.mint.toBase58(),
    instruction: f.instruction, amount: f.amount.toString(), recipientTokenAccount: f.recipient.toBase58(),
    nonce: Buffer.from(f.nonce).toString("hex"), expiresAt: f.expiresAt.toString(), maxUses: f.maxUses,
    actionHash: Buffer.from(pending.intent.actionHash).toString("hex"),
  };
  return validateRecord(config, candidate);
}

export async function saveRecord(config: Config, record: StoredApproval): Promise<void> {
  const checked = validateRecord(config, record);
  await privateDir(config);
  const target = pathFor(config, checked.approvalId);
  const temporary = join(config.stateDir, `.${randomUUID()}.tmp`);
  try {
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(checked)); await file.sync(); }
    finally { await file.close(); }
    await link(temporary, target); // atomic, never replaces an existing request
  } catch {
    throw new StateError("STATE_UNAVAILABLE");
  } finally {
    await unlink(temporary).catch(() => {});
  }
}

export async function loadRecord(config: Config, approvalId: string): Promise<{ record: StoredApproval; pending: PendingApproval }> {
  if (!/^[0-9a-f]{64}$/.test(approvalId)) throw new StateError("APPROVAL_NOT_FOUND");
  await privateDir(config);
  const path = pathFor(config, approvalId);
  let raw: unknown;
  try {
    const info = await lstat(path);
    if (!info.isFile() || (info.mode & 0o077) !== 0 || (process.getuid && info.uid !== process.getuid()) || info.size > 8192) {
      throw new StateError("STATE_UNAVAILABLE");
    }
    raw = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (error instanceof StateError) throw error;
    if (error instanceof Error && "code" in error && error.code === "ENOENT") throw new StateError("APPROVAL_NOT_FOUND");
    throw new StateError("STATE_UNAVAILABLE");
  }
  const record = validateRecord(config, raw);
  if (record.approvalId !== approvalId) throw new StateError("APPROVAL_CONTEXT_MISMATCH");
  const intent = buildIntent({
    programId: new PublicKey(record.programId), authority: new PublicKey(record.authority),
    agent: new PublicKey(record.agent), mint: new PublicKey(record.mint), amount: BigInt(record.amount),
    recipient: new PublicKey(record.recipientTokenAccount), expiresAt: BigInt(record.expiresAt),
    maxUses: 1, nonce: Buffer.from(record.nonce, "hex"),
  });
  return { record, pending: { status: "HUMAN_INTENT_REQUIRED", reason: record.reason, approvalId, approvalUrl: record.approvalUrl, intent } };
}

export function validateRecord(config: Config, raw: unknown): StoredApproval {
  const parsed = recordSchema.safeParse(raw);
  if (!parsed.success) throw new StateError("STATE_UNAVAILABLE");
  const r = parsed.data;
  try {
    const policy = findPolicyPda(config.authority, config.agent.publicKey, PROGRAM_ID);
    const vault = findVaultPda(policy, PROGRAM_ID);
    if (r.endpointFingerprint !== fingerprint(config) || r.genesisHash !== config.genesisHash ||
      r.approvalUrl !== `${config.approvalsUrl}/approvals/${r.approvalId}` ||
      r.programId !== PROGRAM_ID.toBase58() || r.policy !== policy.toBase58() || r.vault !== vault.toBase58() ||
      r.authority !== config.authority.toBase58() || r.agent !== config.agent.publicKey.toBase58() ||
      r.mint !== config.mint.toBase58() || r.requestLifetimeSeconds !== config.requestLifetimeSeconds ||
      r.maxLifetimeSeconds !== config.maxLifetimeSeconds || BigInt(r.amount) > (1n << 64n) - 1n ||
      BigInt(r.expiresAt) <= BigInt(r.requestedAt) || BigInt(r.expiresAt) - BigInt(r.requestedAt) > BigInt(r.maxLifetimeSeconds)) {
      throw new StateError("APPROVAL_CONTEXT_MISMATCH");
    }
    const built = buildIntent({
      programId: PROGRAM_ID, authority: config.authority, agent: config.agent.publicKey, mint: config.mint,
      amount: BigInt(r.amount), recipient: new PublicKey(r.recipientTokenAccount),
      expiresAt: BigInt(r.expiresAt), maxUses: 1, nonce: Buffer.from(r.nonce, "hex"),
    });
    if (Buffer.from(built.actionHash).toString("hex") !== r.actionHash || r.approvalId !== r.actionHash) {
      throw new StateError("APPROVAL_CONTEXT_MISMATCH");
    }
  } catch (error) {
    if (error instanceof StateError) throw error;
    throw new StateError("STATE_UNAVAILABLE");
  }
  return r;
}
