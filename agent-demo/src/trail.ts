import { BorshInstructionCoder, EventParser } from "@anchor-lang/core";
import { PROGRAM_ID, INSTRUCTION_EXECUTE_TRANSFER, computeActionHash, findVaultPda, getProgram, pulsoErrorFromCode } from "@pulso/sdk";
import { getMint, getAccount } from "@solana/spl-token";
import { Connection, PublicKey, type VersionedTransactionResponse } from "@solana/web3.js";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { RPC_URLS } from "./setup.js";

// Read-only: nothing here signs, sends a transaction, or opens a keypair file.

type Base = { slot: number; blockTime: number | null; signature: string };
type Limits = { enabled?: boolean; maxPerTransaction: bigint; dailyLimit: bigint; requireApprovalAbove: bigint; requireApprovalForNewRecipient: boolean; policyVersion: number };

export interface Approval {
  intent: string;
  authority: string;
  issuedAt: number;
  expiresAt: number;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
  actionHash: string;
  /** `unverifiable` when the instruction data or the intent account could not be read. */
  hash: "verified" | "MISMATCH" | "unverifiable";
}

export type Entry = Base &
  (
    | ({ kind: "policy_created" | "policy_updated" } & Limits)
    | { kind: "recipient_approved"; recipient: string }
    | { kind: "approval_recorded"; intent: string; authority: string; actionHash: string; expiresAt: number; maxUses: number }
    | { kind: "transfer"; mode: "autonomous" | "approved"; mint: string; recipient: string; amount: bigint; spentInWindow: bigint; intent?: string; nonce?: string; approval?: Approval }
    | { kind: "refused"; code: number | null; error: string; amount?: bigint; requested?: { amount: bigint; recipient: string } }
    | { kind: "agent_revoked" }
    | { kind: "intent_revoked"; intent: string; authority: string }
  );

export interface Summary {
  autonomous: number;
  approved: number;
  hashVerified: number;
  hashMismatch: number;
  refused: Record<string, number>;
}

export interface Trail {
  policy: { address: string; human: string; agent: string; mint: string | null; decimals: number | null; agentRevoked: boolean } & Required<Limits>;
  entries: Entry[];
  summary: Summary;
}

/** A transaction reduced to what `classify` needs; the RPC-facing code builds it. */
export interface RawTx extends Base {
  /** Anchor custom error code, or null for a failure that is not a custom error. */
  failed: { code: number | null; text: string } | undefined;
  events: { name: string; data: Record<string, any> }[];
  /** Decoded `execute_transfer` instructions of this transaction, in order. */
  transfers: { amount: bigint; nonce: string }[];
}

const s = (x: unknown) => String(x);
const big = (x: unknown) => BigInt(s(x));
const hex = (b: ArrayLike<number>) => Buffer.from(b as Uint8Array).toString("hex");
const limits = (d: Record<string, any>): Limits => ({
  ...(d.enabled !== undefined && { enabled: Boolean(d.enabled) }),
  maxPerTransaction: big(d.maxPerTransaction),
  dailyLimit: big(d.dailyLimit),
  requireApprovalAbove: big(d.requireApprovalAbove),
  requireApprovalForNewRecipient: Boolean(d.requireApprovalForNewRecipient),
  policyVersion: Number(d.policyVersion),
});

/** Pure: decoded events and error of one transaction to trail entries. */
export function classify(tx: RawTx): Entry[] {
  const base = { slot: tx.slot, blockTime: tx.blockTime, signature: tx.signature };
  if (tx.failed) {
    const { code, text } = tx.failed;
    const required = tx.events.find((e) => e.name.toLowerCase() === "intentrequired")?.data;
    const attempted = tx.transfers[0]?.amount;
    return [
      {
        ...base,
        kind: "refused",
        code,
        error: (code !== null && pulsoErrorFromCode(code)?.message) || text,
        ...(attempted !== undefined && { amount: attempted }),
        ...(required && { requested: { amount: big(required.amount), recipient: s(required.recipient) } }),
      },
    ];
  }
  let nextTransfer = 0;
  const out: Entry[] = [];
  for (const { name, data: d } of tx.events) {
    switch (name.toLowerCase()) {
      case "policycreated": out.push({ ...base, kind: "policy_created", ...limits(d) }); break;
      case "policyupdated": out.push({ ...base, kind: "policy_updated", ...limits(d) }); break;
      case "recipientapproved": out.push({ ...base, kind: "recipient_approved", recipient: s(d.recipient) }); break;
      case "intentrecorded":
        out.push({ ...base, kind: "approval_recorded", intent: s(d.intent), authority: s(d.authority), actionHash: hex(d.actionHash), expiresAt: Number(s(d.expiresAt)), maxUses: Number(d.maxUses) });
        break;
      case "transferexecuted": {
        const t = tx.transfers[nextTransfer++];
        const intent = d.intent ? s(d.intent) : undefined;
        out.push({ ...base, kind: "transfer", mode: intent ? "approved" : "autonomous", mint: s(d.mint), recipient: s(d.recipient), amount: big(d.amount), spentInWindow: big(d.spentInWindow), ...(intent && { intent }), ...(t && { nonce: t.nonce }) });
        break;
      }
      case "intentrevocation": out.push({ ...base, kind: "intent_revoked", intent: s(d.intent), authority: s(d.authority) }); break;
      case "agentrevoked": out.push({ ...base, kind: "agent_revoked" }); break;
    }
  }
  return out;
}

export interface IntentAccount {
  authority: unknown;
  actionHash: ArrayLike<number>;
  issuedAt: unknown;
  expiresAt: unknown;
  maxUses: number;
  usedCount: number;
  revoked: boolean;
}

/** Pure: recompute the action hash of each approved transfer from public data and compare it with the one on chain. */
export function attachApprovals(entries: Entry[], intents: Map<string, IntentAccount>, policy: { human: string; agent: string }): Entry[] {
  return entries.map((e) => {
    if (e.kind !== "transfer" || !e.intent) return e;
    const acct = intents.get(e.intent);
    if (!acct) return e;
    const onChain = hex(acct.actionHash);
    let hash: Approval["hash"] = "unverifiable";
    if (e.nonce) {
      const recomputed = computeActionHash({
        programId: PROGRAM_ID,
        instruction: INSTRUCTION_EXECUTE_TRANSFER,
        authority: new PublicKey(policy.human),
        agent: new PublicKey(policy.agent),
        mint: new PublicKey(e.mint),
        amount: e.amount,
        recipient: new PublicKey(e.recipient),
        maxUses: acct.maxUses,
        nonce: Uint8Array.from(Buffer.from(e.nonce, "hex")),
        expiresAt: big(acct.expiresAt),
      });
      hash = hex(recomputed) === onChain ? "verified" : "MISMATCH";
    }
    return { ...e, approval: { intent: e.intent, authority: s(acct.authority), issuedAt: Number(s(acct.issuedAt)), expiresAt: Number(s(acct.expiresAt)), maxUses: acct.maxUses, usedCount: acct.usedCount, revoked: acct.revoked, actionHash: onChain, hash } };
  });
}

export function summarize(entries: Entry[]): Summary {
  const sum: Summary = { autonomous: 0, approved: 0, hashVerified: 0, hashMismatch: 0, refused: {} };
  for (const e of entries) {
    if (e.kind === "transfer" && e.mode === "autonomous") sum.autonomous++;
    if (e.kind === "transfer" && e.mode === "approved") {
      sum.approved++;
      if (e.approval?.hash === "verified") sum.hashVerified++;
      if (e.approval?.hash === "MISMATCH") sum.hashMismatch++;
    }
    if (e.kind === "refused") sum.refused[e.error] = (sum.refused[e.error] ?? 0) + 1;
  }
  return sum;
}

const short = (x: string) => (x.length > 12 ? `${x.slice(0, 4)}…${x.slice(-5)}` : x);
const utc = (t: number | null) => (t === null ? "unknown time" : new Date(t * 1000).toISOString().slice(0, 19) + "Z");
const amountText = (raw: bigint, decimals: number | null) => {
  if (decimals === null) return `${raw} raw`;
  const base = 10n ** BigInt(decimals);
  const frac = (raw % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${raw / base}${frac ? `.${frac}` : ""}`;
};

/** Pure: the text report, one or two short lines per entry. */
export function formatTrail(t: Trail): string[] {
  const d = t.policy.decimals;
  const a = (n: bigint) => amountText(n, d);
  const p = t.policy;
  const lines = [
    `policy ${short(p.address)}  human ${short(p.human)}  agent ${short(p.agent)}  v${p.policyVersion}${p.enabled ? "" : "  DISABLED"}${p.agentRevoked ? "  AGENT REVOKED" : ""}`,
    `limits: max ${a(p.maxPerTransaction)}/tx, ${a(p.dailyLimit)}/day, human approval above ${a(p.requireApprovalAbove)}${p.requireApprovalForNewRecipient ? " or for a new recipient" : ""}`,
    "",
  ];
  for (const e of t.entries) {
    const head = `${utc(e.blockTime)}  ${short(e.signature)}  `;
    switch (e.kind) {
      case "policy_created":
      case "policy_updated":
        lines.push(`${head}${e.kind === "policy_created" ? "policy created" : "policy updated"}  v${e.policyVersion}  max ${a(e.maxPerTransaction)}/tx, ${a(e.dailyLimit)}/day, approval above ${a(e.requireApprovalAbove)}`);
        break;
      case "recipient_approved": lines.push(`${head}recipient approved  ${short(e.recipient)}`); break;
      case "approval_recorded":
        lines.push(`${head}approval recorded  by human ${short(e.authority)}`, `    intent ${short(e.intent)}  hash ${short(e.actionHash)}  expires ${utc(e.expiresAt)}  uses ${e.maxUses}`);
        break;
      case "transfer": {
        const to = `${a(e.amount)} to ${short(e.recipient)}`;
        if (!e.approval) { lines.push(`${head}transfer ${e.mode === "approved" ? "approved" : "autonomous"}  ${to}${e.intent ? `  intent ${short(e.intent)}` : ""}`); break; }
        const ap = e.approval;
        lines.push(
          `${head}transfer approved  ${to}`,
          `    approved by human ${short(ap.authority)} at ${utc(ap.issuedAt)}  intent ${short(ap.intent)}  used ${ap.usedCount}/${ap.maxUses}${ap.revoked ? "  REVOKED" : ""}  ${ap.hash === "MISMATCH" ? "!!! HASH MISMATCH !!!" : ap.hash === "verified" ? "hash verified" : "hash unverifiable"}`,
        );
        break;
      }
      case "refused":
        lines.push(`${head}REFUSED  ${e.error}${e.code !== null ? ` (${e.code})` : ""}${e.amount !== undefined ? `  attempted ${a(e.amount)}` : ""}`);
        if (e.requested) lines.push(`    human approval needed for ${a(e.requested.amount)} to ${short(e.requested.recipient)}`);
        break;
      case "agent_revoked": lines.push(`${head}agent revoked`); break;
      case "intent_revoked": lines.push(`${head}approval revoked  intent ${short(e.intent)}  by human ${short(e.authority)}`); break;
    }
  }
  const sm = t.summary;
  const refused = Object.entries(sm.refused).map(([k, n]) => `${n}× ${k}`).join(", ");
  lines.push(
    "",
    `summary: ${sm.autonomous} autonomous, ${sm.approved} approved (${sm.hashVerified}/${sm.approved} hash verified${sm.hashMismatch ? `, ${sm.hashMismatch} MISMATCH` : ""}), ${Object.values(sm.refused).reduce((x, y) => x + y, 0)} refused${refused ? ` (${refused})` : ""}`,
    "NOT AUDITED · DEVNET DEMONSTRATION ONLY",
  );
  return lines;
}

function toRaw(res: VersionedTransactionResponse, signature: string, program: ReturnType<typeof getProgram>, parser: EventParser): RawTx {
  const meta = res.meta;
  const logs = meta?.logMessages ?? [];
  const keys = res.transaction.message.getAccountKeys({ accountKeysFromLookups: meta?.loadedAddresses });
  const ixCoder = new BorshInstructionCoder(program.idl);
  const transfers: RawTx["transfers"] = [];
  for (const ix of res.transaction.message.compiledInstructions) {
    if (!keys.get(ix.programIdIndex)?.equals(PROGRAM_ID)) continue;
    const dec = ixCoder.decode(Buffer.from(ix.data).toString("hex"), "hex");
    if (dec?.name.toLowerCase() === "executetransfer") {
      const data = dec.data as { amount: unknown; nonce: ArrayLike<number> };
      transfers.push({ amount: big(data.amount), nonce: hex(data.nonce) });
    }
  }
  const err = meta?.err as { InstructionError?: [number, { Custom?: number } | string] } | null | undefined;
  const custom = err?.InstructionError?.[1];
  return {
    signature,
    slot: res.slot,
    blockTime: res.blockTime ?? null,
    failed: err ? { code: typeof custom === "object" ? (custom.Custom ?? null) : null, text: JSON.stringify(err) } : undefined,
    events: [...parser.parseLogs(logs)].map((e) => ({ name: e.name, data: e.data as Record<string, any> })),
    transfers,
  };
}

/** Read every transaction that touches `policy`, oldest first, and turn it into the authorization trail. */
export async function readTrail(connection: Connection, policy: PublicKey): Promise<Trail> {
  const program = getProgram(connection);
  // A wrong account type is "not a policy"; an RPC failure must surface as itself.
  const acct = await program.account.agentPolicy.fetchNullable(policy).catch((e: Error) => {
    if (/discriminator/i.test(e.message)) return null;
    throw e;
  });
  if (!acct) throw new Error(`${policy.toBase58()} is not a PULSO policy account of program ${PROGRAM_ID.toBase58()}`);
  const parser = new EventParser(PROGRAM_ID, program.coder);

  const sigs = [];
  for (let before: string | undefined; ; ) {
    const page = await connection.getSignaturesForAddress(policy, { before, limit: 1000 }, "confirmed");
    sigs.push(...page);
    if (page.length < 1000) break;
    before = page[page.length - 1]!.signature;
  }
  const ordered = sigs.reverse().sort((x, y) => x.slot - y.slot);

  let entries: Entry[] = [];
  for (const { signature } of ordered) {
    const res = await connection.getTransaction(signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (res) entries.push(...classify(toRaw(res, signature, program, parser)));
  }

  const human = acct.human.toBase58();
  const agent = acct.agent.toBase58();
  const intents = new Map<string, IntentAccount>();
  for (const e of entries) {
    if (e.kind === "transfer" && e.intent && !intents.has(e.intent)) {
      const i = await program.account.intentAuthorization.fetchNullable(new PublicKey(e.intent));
      if (i) intents.set(e.intent, i);
    }
  }
  entries = attachApprovals(entries, intents, { human, agent });

  let mint: string | null = null;
  let decimals: number | null = null;
  try {
    const vault = await getAccount(connection, findVaultPda(policy));
    mint = vault.mint.toBase58();
    decimals = (await getMint(connection, vault.mint)).decimals;
  } catch {
    // Vault gone or unreadable: amounts are shown raw.
  }
  return {
    policy: {
      address: policy.toBase58(), human, agent, mint, decimals, agentRevoked: acct.agentRevoked, enabled: acct.enabled,
      maxPerTransaction: big(acct.maxPerTransaction), dailyLimit: big(acct.dailyLimit), requireApprovalAbove: big(acct.requireApprovalAbove),
      requireApprovalForNewRecipient: acct.requireApprovalForNewRecipient, policyVersion: acct.policyVersion,
    },
    entries,
    summary: summarize(entries),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((x) => x !== "--"),
    options: { policy: { type: "string" }, rpc: { type: "string", default: RPC_URLS.localnet }, json: { type: "boolean", default: false } },
  });
  const fail = (m: string): never => (console.error(`trail failed: ${m}`), process.exit(1));
  if (!values.policy) fail("--policy <pubkey> is required");
  let policy: PublicKey;
  try {
    policy = new PublicKey(values.policy!);
  } catch {
    policy = fail(`--policy is not a valid public key: ${values.policy}`);
  }
  readTrail(new Connection(values.rpc!, "confirmed"), policy!)
    .then((t) => {
      console.log(values.json ? JSON.stringify(t, (_, v) => (typeof v === "bigint" ? v.toString() : v), 2) : formatTrail(t).join("\n"));
      process.exit(0);
    })
    .catch((e: Error) => fail(e.message));
}
