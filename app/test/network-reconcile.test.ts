// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// No network: a double of the connection subset the reconciliation touches (spec 14 section 8).
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivateKey, createHash, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, findIntentPda, findPolicyPda, findVaultPda } from "@pulso/sdk/src/pda.js";
import { computeActionHash, INSTRUCTION_EXECUTE_TRANSFER } from "@pulso/sdk/src/intent.js";
import { mutateCollection, readCollection } from "../lib/network-store";
import { TOKEN_PROGRAM_ID, createOrganization, type AccountData, type OrgDeps } from "../lib/network-store-orgs";
import { prepareInvite, submitInvite, prepareAccept as prepareConnAccept, accept as acceptConn } from "../lib/network-store-connections";
import { REQUESTS, cancelRequest, declineRequest, prepareRequest, submitRequest, type B2BRequest, type Snapshot } from "../lib/network-requests";
import { commitmentFromEnv, getReconciliation, reconcileRequest, type ReconcileConnection, type ReconcileDeps, type ReconcileOut } from "../lib/network-reconcile";

const HOST = "pulso.test";
const CLUSTER = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const NOW = 1_800_000_000_000;
const EXP = String(NOW / 1000 + 86_400);
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const signB64 = (kp: Keypair, message: string) =>
  sign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, kp.secretKey.slice(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");
const pub = (kp: Keypair) => kp.publicKey.toBase58();
const ok = <T,>(r: T): Exclude<T, { error: string }> => {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r as Exclude<T, { error: string }>;
};
const fail = (r: unknown) => r as { status: number; code: string };
const sigN = (n: number) => String(n).repeat(88);
const [S1, S2, S3] = [sigN(2), sigN(3), sigN(4)];

const P = Keypair.generate(); // payer organization authority
const R = Keypair.generate(); // receiver organization authority
const X = Keypair.generate(); // third party
const AGENT = Keypair.generate();
const MINT = Keypair.generate();
const RECV = Keypair.generate(); // R's token account
const TOKEN = new PublicKey(TOKEN_PROGRAM_ID);
const POLICY = findPolicyPda(P.publicKey, AGENT.publicKey);
const VAULT = findVaultPda(POLICY);

function tokenAccount(mint: Keypair, owner: Keypair): Uint8Array {
  const data = new Uint8Array(165);
  data.set(mint.publicKey.toBytes(), 0);
  data.set(owner.publicKey.toBytes(), 32);
  data[108] = 1;
  return data;
}
const storePolicy = () => Uint8Array.from([...createHash("sha256").update("account:AgentPolicy").digest().subarray(0, 8), ...new Array(40).fill(0)]);

// ---------- the chain double ----------

type Level = "processed" | "confirmed" | "finalized";
interface TxOpts { amount?: bigint; mode?: "autonomous" | "approved"; recipient?: PublicKey; mint?: PublicKey; nonce?: string; human?: Keypair; agent?: Keypair; err?: unknown; blockTime?: number | null; programId?: PublicKey }

class Chain {
  genesis = CLUSTER;
  level: Level = "confirmed";
  down = { genesis: false, statuses: false, tx: false };
  recipientOwner: Keypair | null = R;
  txs = new Map<string, unknown>();
  accounts = new Map<string, { owner: PublicKey; data: Buffer }>();
  calls = { statuses: 0 };

  /** A PULSO execute_transfer for `snap`, tweakable per test. */
  add(sig: string, snap: Snapshot, o: TxOpts = {}) {
    const human = o.human ?? P, agent = o.agent ?? AGENT;
    const policy = findPolicyPda(human.publicKey, agent.publicKey), vault = findVaultPda(policy);
    const recipient = o.recipient ?? RECV.publicKey, mint = o.mint ?? MINT.publicKey;
    const amount = o.amount ?? BigInt(snap.amount), nonce = Buffer.from(o.nonce ?? snap.nonce, "hex");
    const program = o.programId ?? PROGRAM_ID;
    const approved = o.mode === "approved";
    const hash = computeActionHash({ programId: PROGRAM_ID, instruction: INSTRUCTION_EXECUTE_TRANSFER, authority: human.publicKey, agent: agent.publicKey, mint, amount, recipient, maxUses: 1, nonce, expiresAt: 1_900_000_000n });
    const intent = findIntentPda(human.publicKey, hash, PROGRAM_ID);
    const pol = new Uint8Array(120);
    pol.set([148, 193, 218, 129, 21, 96, 195, 77]);
    pol.set(human.publicKey.toBytes(), 8);
    pol.set(agent.publicKey.toBytes(), 40);
    this.accounts.set(policy.toBase58(), { owner: PROGRAM_ID, data: Buffer.from(pol) });
    const it = new Uint8Array(126);
    it.set([150, 220, 148, 182, 20, 199, 128, 11]);
    it.set(human.publicKey.toBytes(), 8);
    it.set(agent.publicKey.toBytes(), 40);
    it.set(hash, 72);
    new DataView(it.buffer).setBigInt64(112, 1_900_000_000n, true);
    new DataView(it.buffer).setUint16(120, 1, true);
    this.accounts.set(intent.toBase58(), { owner: PROGRAM_ID, data: Buffer.from(it) });
    const data = new Uint8Array(32);
    data.set([233, 126, 160, 184, 235, 206, 31, 119]);
    new DataView(data.buffer).setBigUint64(8, amount, true);
    data.set(nonce, 16);
    this.txs.set(sig, {
      slot: 42,
      blockTime: o.blockTime === undefined ? Number(EXP) - 1000 : o.blockTime,
      transaction: { message: { header: { numRequiredSignatures: 1 }, staticAccountKeys: [agent.publicKey, policy, vault, recipient, TOKEN, program, intent],
        compiledInstructions: [{ programIdIndex: 5, accountKeyIndexes: approved ? [0, 1, 2, 3, 4, 6] : [0, 1, 2, 3, 4], data }] } },
      meta: {
        err: o.err ?? null,
        preTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: "0", decimals: 6 } }],
        postTokenBalances: [{ accountIndex: 3, mint: mint.toBase58(), uiTokenAmount: { amount: amount.toString(), decimals: 6 } }],
      },
    });
    return { intent: intent.toBase58(), hash: Buffer.from(hash).toString("hex") };
  }

  conn(): ReconcileConnection {
    return {
      getGenesisHash: async () => { if (this.down.genesis) throw new Error("rpc down"); return this.genesis; },
      getSignatureStatuses: async (sigs: string[]) => {
        this.calls.statuses += 1;
        if (this.down.statuses) throw new Error("rpc down");
        return { context: { slot: 1 }, value: sigs.map((s) => { const t = this.txs.get(s) as { meta: { err: unknown } } | undefined; return t ? { slot: 42, confirmations: 1, err: t.meta.err, confirmationStatus: this.level } : null; }) };
      },
      getTransaction: async (s: string) => { if (this.down.tx) throw new Error("rpc down"); return (this.txs.get(s) ?? null) as never; },
      getAccountInfo: async (k: PublicKey) => {
        if (k.equals(RECV.publicKey)) return this.recipientOwner ? ({ owner: TOKEN, data: Buffer.from(tokenAccount(MINT, this.recipientOwner)), lamports: 1, executable: false } as never) : null;
        const a = this.accounts.get(k.toBase58());
        return a ? ({ ...a, lamports: 1, executable: false } as never) : null;
      },
    } as unknown as ReconcileConnection;
  }
}

// ---------- fixtures (same shape as network-requests.test.ts) ----------

let dir: string;
let accounts: Map<string, AccountData>;
let deps: OrgDeps;
let chain: Chain;
const rd = (over: Partial<ReconcileDeps> = {}): ReconcileDeps => ({ dir, now: NOW, connection: chain.conn(), commitment: "confirmed", ...over });

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pulso-network-reconcile-"));
  accounts = new Map();
  chain = new Chain();
  deps = { dir, cluster: CLUSTER, now: NOW, readAccount: async (k) => accounts.get(k) ?? null };
  accounts.set(RECV.publicKey.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, R) });
  accounts.set(POLICY.toBase58(), { owner: PROGRAM_ID.toBase58(), data: storePolicy() });
  accounts.set(VAULT.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, P) });
  ok(await createOrganization(deps, pub(P), { handle: "payer", displayName: "Payer", payerAgent: pub(AGENT) }));
  ok(await createOrganization(deps, pub(R), { handle: "receiver", displayName: "Receiver", receivingAccount: RECV.publicKey.toBase58() }));
  ok(await createOrganization(deps, pub(X), { handle: "third", displayName: "Third" }));
  const inv = ok(await prepareInvite(deps, HOST, pub(P), { authority: pub(R) })) as { id: string; message: string; nonce: string };
  ok(await submitInvite(deps, HOST, pub(P), { id: inv.id, target: pub(R), nonce: inv.nonce, signature: signB64(P, inv.message) }));
  const acc = ok(await prepareConnAccept(deps, HOST, pub(R), inv.id)) as { message: string; nonce: string };
  ok(await acceptConn(deps, HOST, pub(R), inv.id, { nonce: acc.nonce, signature: signB64(R, acc.message) }));
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** R issues a charge to P: `aguardando autorização`. */
async function charge(over: Record<string, unknown> = {}): Promise<{ id: string; snap: Snapshot }> {
  const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), amount: "1000000", expiry: EXP, ...over })) as { snapshot: Snapshot; message: string; nonce: string };
  const r = ok(await submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, description: over.description, nonce: p.nonce, signature: signB64(R, p.message) }));
  return { id: r.id, snap: p.snapshot };
}
const stored = async (id: string) => (await readCollection<B2BRequest>(dir, REQUESTS)).find((r) => r.id === id)!;
const run = async (id: string, sig: string, by = P, d = rd()) => ok(await reconcileRequest(d, pub(by), id, { signature: sig })) as ReconcileOut;
const edit = (id: string, f: (r: B2BRequest) => void) => mutateCollection<B2BRequest, void>(dir, REQUESTS, (items) => f(items.find((r) => r.id === id)!));

// ---------- happy paths ----------

describe("reconcile: verified", () => {
  it("autonomous payment: line 9 then 11, payment evidence written once", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ code: "VERIFIED", refused: false });
    expect(out.request.status).toBe("verificado");
    const r = await stored(id);
    expect(r.history.map((h) => h.to).slice(-2)).toEqual(["enviado", "verificado"]);
    expect(r.signature).toBe(S1);
    expect(r.evidence.payment).toMatchObject({ signature: S1, commitment: "confirmed", slot: 42, mode: "autônomo", receipt: { amount: "1000000", mode: "autonomous", nonce: snap.nonce, human: pub(P) } });
    expect(r.evidence.payment?.intent).toBeUndefined();
    expect(r.evidence.recipientOwnerAtVerification).toBe(pub(R));
    expect(out.reconcile?.warning).toBeUndefined();
    expect(r.late).toBeNull();
  });

  it("approved payment: carries the intent and the action hash", async () => {
    const { id, snap } = await charge();
    const { intent, hash } = chain.add(S1, snap, { mode: "approved" });
    expect((await run(id, S1)).request.status).toBe("verificado");
    expect((await stored(id)).evidence.payment).toMatchObject({ mode: "aprovado", intent, actionHash: hash, receipt: { hashVerified: true } });
  });

  it("both participants see the same result; a third party gets 404", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    await run(id, S1, R); // the receiver reports
    const [a, b] = [ok(await getReconciliation({ dir, now: NOW }, pub(P), id)), ok(await getReconciliation({ dir, now: NOW }, pub(R), id))];
    expect(a.reconcile).toMatchObject({ code: "VERIFIED" });
    expect(a.request.evidence.payment).toEqual(b.request.evidence.payment);
    expect(a.request.history).toEqual(b.request.history);
    expect(fail(await getReconciliation({ dir, now: NOW }, pub(X), id)).status).toBe(404);
    expect(fail(await reconcileRequest(rd(), pub(X), id, { signature: S1 })).status).toBe(404);
  });

  it("POST is idempotent: the same signature again changes nothing", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    await run(id, S1);
    const rev = (await stored(id)).rev;
    const calls = chain.calls.statuses;
    expect((await run(id, S1, R)).reconcile).toMatchObject({ code: "VERIFIED" });
    expect((await stored(id)).rev).toBe(rev);
    expect(chain.calls.statuses).toBe(calls); // already recorded: no new chain read
  });

  it("ignores status, mode, amount and result in the body: only the signature is read", async () => {
    const { id } = await charge(); // no tx on the chain
    const out = ok(await reconcileRequest(rd(), pub(P), id, { signature: S1, status: "verificado", mode: "aprovado", amount: "1", result: "ok", payment: { signature: S1 } } as never)) as ReconcileOut;
    expect(out.reconcile).toMatchObject({ code: "TX_NOT_FOUND", retry: true });
    const r = await stored(id);
    expect(r.status).toBe("enviado");
    expect(r.evidence.payment).toBeUndefined();
  });

  it("owner of the destination account changed: a warning, not a refusal", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.recipientOwner = X;
    const out = await run(id, S1);
    expect(out.request.status).toBe("verificado");
    expect(out.reconcile?.warning).toBe("RECIPIENT_OWNER_CHANGED");
    expect((await stored(id)).evidence.recipientOwnerAtVerification).toBe(pub(X));
  });

  it("a malformed signature is refused before anything is written", async () => {
    const { id } = await charge();
    expect(fail(await reconcileRequest(rd(), pub(P), id, { signature: "nope" })).code).toBe("BAD_SIGNATURE");
    expect(fail(await reconcileRequest(rd(), pub(P), id, {})).code).toBe("BAD_SIGNATURE");
    expect((await stored(id)).status).toBe("aguardando autorização");
  });
});

// ---------- refusals of step B ----------

describe("reconcile: the transaction does not match the request", () => {
  async function refused(opts: TxOpts, code: string) {
    const { id, snap } = await charge();
    chain.add(S1, snap, opts);
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ code, refused: true });
    const r = await stored(id);
    expect(r.status).toBe("aguardando autorização"); // not burned: back to waiting
    expect(r.signature).toBeNull();
    expect(r.attempts).toHaveLength(1);
    expect(r.attempts[0]).toMatchObject({ signature: S1 });
    expect(r.attempts[0].reason.startsWith(code)).toBe(true);
    expect(r.evidence.payment).toBeUndefined();
    return { id, snap, r };
  }

  it("more than the exact amount: AMOUNT_NOT_EXACT (the v1 receipt would accept it)", () => refused({ amount: 2_000_000n }, "AMOUNT_NOT_EXACT"));
  it("less than the amount: AMOUNT_TOO_LOW from the v1 receipt", () => refused({ amount: 1n }, "AMOUNT_TOO_LOW"));
  it("another mint: MINT_MISMATCH", () => refused({ mint: Keypair.generate().publicKey }, "MINT_MISMATCH"));
  it("another destination: RECIPIENT_MISMATCH", () => refused({ recipient: Keypair.generate().publicKey }, "RECIPIENT_MISMATCH"));
  it("another nonce: NONCE_MISMATCH", () => refused({ nonce: "ab".repeat(16) }, "NONCE_MISMATCH"));
  it("another program: NOT_PULSO_TRANSFER", () => refused({ programId: Keypair.generate().publicKey }, "NOT_PULSO_TRANSFER"));
  it("another human authorizing: AUTHORITY_NOT_ACCEPTED", () => refused({ human: Keypair.generate() }, "AUTHORITY_NOT_ACCEPTED"));
  it("another agent, therefore another policy: SNAPSHOT_MISMATCH", () => refused({ agent: Keypair.generate() }, "SNAPSHOT_MISMATCH"));

  it("server RPC on another cluster: CLUSTER_MISMATCH is retryable and burns nothing", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.genesis = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ code: "CLUSTER_MISMATCH", refused: false, retry: true });
    expect((await stored(id)).status).toBe("enviado");
    expect((await stored(id)).attempts).toEqual([]);
    chain.genesis = snap.genesis; // RPC fixed: the same signature now verifies
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "VERIFIED" });
  });

  it("digest tampered in the store: SNAPSHOT_MISMATCH recorded, and the request is reported as broken", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    await edit(id, (r) => { r.digest = "0".repeat(64); });
    expect(fail(await reconcileRequest(rd(), pub(P), id, { signature: S1 })).code).toBe("DIGEST_MISMATCH");
    const r = await stored(id);
    expect(r.attempts[0].reason.startsWith("SNAPSHOT_MISMATCH")).toBe(true);
    expect(r.evidence.payment).toBeUndefined();
  });

  it("the receiving organization no longer exists: SNAPSHOT_MISMATCH", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    await mutateCollection<{ authority: string }, void>(dir, "organizations", (items) => { items.splice(items.findIndex((o) => o.authority === pub(R)), 1); });
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "SNAPSHOT_MISMATCH", refused: true });
  });

  it("signature already used by another request: 409 at line 9, and a refusal if it appears under the lock", async () => {
    const a = await charge();
    const b = await charge({ amount: "7" });
    chain.add(S1, a.snap);
    await run(a.id, S1);
    expect(fail(await reconcileRequest(rd(), pub(P), b.id, { signature: S1 })).code).toBe("SIGNATURE_IN_USE");
    expect((await stored(b.id)).status).toBe("aguardando autorização");
    // bound first, then another request takes the signature before the write: refused with SIGNATURE_IN_USE
    chain.add(S2, b.snap);
    chain.down.tx = true;
    await run(b.id, S2); // confirmado
    chain.down.tx = false;
    await edit(a.id, (r) => { r.evidence.duplicates = [{ signature: S2, commitment: "confirmed", at: "t" }]; });
    expect((await run(b.id, S2)).reconcile).toMatchObject({ code: "SIGNATURE_IN_USE", refused: true });
    expect((await stored(b.id)).status).toBe("aguardando autorização");
  });

  it("a refused signature is not re-run: same answer, no second attempt", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap, { amount: 2_000_000n });
    await run(id, S1);
    const again = await run(id, S1, R);
    expect(again.reconcile).toMatchObject({ code: "AMOUNT_NOT_EXACT", refused: true });
    expect((await stored(id)).attempts).toHaveLength(1);
    // a correct payment can still be reported after the refusal
    chain.add(S2, snap);
    expect((await run(id, S2)).request.status).toBe("verificado");
  });

  it("refusal after the deadline goes to expirado, not back to waiting", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap, { amount: 2_000_000n });
    chain.down.tx = true;
    await run(id, S1); // reported in time, confirmado
    chain.down.tx = false;
    const later = NOW + 2 * 86_400_000;
    const out = await run(id, S1, P, rd({ now: later }));
    expect(out.reconcile).toMatchObject({ code: "AMOUNT_NOT_EXACT" });
    expect(out.request.status).toBe("expirado");
  });
});

// ---------- step A and the RPC ----------

describe("reconcile: existence and availability", () => {
  it("unknown transaction: stays enviado and is safe to repeat", async () => {
    const { id, snap } = await charge();
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "TX_NOT_FOUND", retry: true });
    expect((await stored(id)).status).toBe("enviado");
    chain.add(S1, snap);
    expect((await run(id, S1)).request.status).toBe("verificado"); // retry, same signature
  });

  it("failed transaction: line 12 with the reason in attempts", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap, { err: { InstructionError: [0, "Custom"] } });
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ code: "TX_FAILED", refused: true });
    const r = await stored(id);
    expect(r.status).toBe("aguardando autorização");
    expect(r.attempts[0].reason).toContain("TX_FAILED");
    expect(r.attempts[0].reason).toContain("InstructionError");
  });

  it("below the configured commitment: stays enviado; reaching it verifies", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.level = "processed";
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "BELOW_COMMITMENT" });
    expect((await stored(id)).status).toBe("enviado");
    chain.level = "confirmed";
    expect((await run(id, S1)).request.status).toBe("verificado");
  });

  it("finalized configured: confirmed is not enough, and the payment records finalized", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    const fin = () => rd({ commitment: "finalized" });
    expect((await run(id, S1, P, fin())).reconcile).toMatchObject({ code: "BELOW_COMMITMENT" });
    chain.level = "finalized";
    expect((await run(id, S1, P, fin())).request.status).toBe("verificado");
    expect((await stored(id)).evidence.payment?.commitment).toBe("finalized");
  });

  it("commitment from the environment: confirmed by default, finalized allowed, processed refused", () => {
    expect(commitmentFromEnv(undefined)).toBe("confirmed");
    expect(commitmentFromEnv("finalized")).toBe("finalized");
    expect(() => commitmentFromEnv("processed")).toThrow();
  });

  it("RPC down at step A: stays enviado, never success", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.down.statuses = true;
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "RPC_ERROR", retry: true });
    chain.down.statuses = false;
    chain.down.genesis = true;
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "RPC_ERROR" });
    const r = await stored(id);
    expect(r.status).toBe("enviado");
    expect(r.evidence.payment).toBeUndefined();
  });

  it("RPC down at step B: confirmado, then a retry verifies", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.down.tx = true;
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ code: "CONFIRMED_UNVERIFIED", retry: true });
    expect(out.request.status).toBe("confirmado");
    expect((await run(id, S1)).request.status).toBe("confirmado"); // still down: unchanged
    chain.down.tx = false;
    const done = await run(id, S1, R); // either participant may retry
    expect(done.request.status).toBe("verificado");
    expect((await stored(id)).history.map((h) => h.to).slice(-3)).toEqual(["enviado", "confirmado", "verificado"]);
  });

  it("a different signature while one is pending is a conflict, not a replacement", async () => {
    const { id } = await charge();
    await run(id, S1);
    expect(fail(await reconcileRequest(rd(), pub(P), id, { signature: S2 })).status).toBe(409);
  });
});

// ---------- time ----------

describe("reconcile: expiry", () => {
  it("reported in time but landed after expiry: verificado with the after_expiry_landed mark", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap, { blockTime: Number(EXP) + 10 });
    const out = await run(id, S1);
    expect(out.request.status).toBe("verificado");
    expect(out.request.late).toMatchObject({ reason: "after_expiry_landed", signature: S1, verified: true });
  });

  it("no block time: the server's observation time stands in", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap, { blockTime: null });
    await run(id, S1);
    expect((await stored(id)).evidence.payment).toMatchObject({ blockTime: null, observedAt: new Date(NOW).toISOString() });
  });

  it("cannot be reported on a live request once it expired: it takes the late path", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    const out = await run(id, S1, P, rd({ now: NOW + 2 * 86_400_000 }));
    expect(out.request.status).toBe("expirado");
    expect(out.request.late).toMatchObject({ reason: "after_expiry", verified: true });
    expect((await stored(id)).evidence.payment).toBeUndefined();
  });
});

// ---------- late payment ----------

describe("reconcile: late payment on an ended request (line 13)", () => {
  const ended = {
    after_cancel: async (id: string) => ok(await cancelRequest(deps, pub(R), id)),
    after_refusal: async (id: string) => ok(await declineRequest(deps, pub(P), id)),
  };
  for (const [reason, end] of Object.entries(ended)) {
    it(`${reason}: marked, state intact, only one`, async () => {
      const { id, snap } = await charge();
      await end(id);
      const state = (await stored(id)).status;
      chain.add(S1, snap);
      chain.add(S2, snap);
      const out = await run(id, S1);
      expect(out.reconcile).toMatchObject({ code: "LATE_RECORDED" });
      expect(out.request.status).toBe(state);
      expect(out.request.late).toMatchObject({ reason, signature: S1, commitment: "confirmed", verified: true });
      expect((await run(id, S1, R)).reconcile).toMatchObject({ code: "LATE_RECORDED" }); // idempotent
      expect(fail(await reconcileRequest(rd(), pub(P), id, { signature: S2 })).status).toBe(409); // only one
      expect((await stored(id)).late?.signature).toBe(S1);
    });
  }

  it("a late payment that does not match the terms is reported but not marked", async () => {
    const { id, snap } = await charge();
    await ended.after_cancel(id);
    chain.add(S1, snap, { amount: 5n });
    const out = await run(id, S1);
    expect(out.reconcile).toMatchObject({ refused: true });
    expect(out.request.status).toBe("cancelado");
    expect(out.request.late).toBeNull();
    expect((await stored(id)).attempts).toHaveLength(0);
  });

  it("an unknown transaction on an ended request writes nothing", async () => {
    const { id } = await charge();
    await ended.after_refusal(id);
    const rev = (await stored(id)).rev;
    expect((await run(id, S1)).reconcile).toMatchObject({ code: "TX_NOT_FOUND" });
    expect((await stored(id)).rev).toBe(rev);
  });
});

// ---------- exactly once ----------

describe("reconcile: consumption", () => {
  it("two concurrent verifications: one writes, the other receives the recorded result", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    const [a, b] = await Promise.all([reconcileRequest(rd(), pub(P), id, { signature: S1 }), reconcileRequest(rd(), pub(R), id, { signature: S1 })]);
    for (const x of [a, b]) expect(ok(x)).toMatchObject({ reconcile: { code: "VERIFIED" }, request: { status: "verificado" } });
    const r = await stored(id);
    expect(r.history.filter((h) => h.to === "verificado")).toHaveLength(1);
    expect(r.history.filter((h) => h.to === "enviado")).toHaveLength(1);
    expect(r.evidence.payment?.signature).toBe(S1);
  });

  it("a second valid payment for a verified request is a duplicate: recorded, state untouched", async () => {
    const { id, snap } = await charge();
    chain.add(S1, snap);
    chain.add(S2, snap, { mode: "approved" });
    await run(id, S1);
    const before = await stored(id);
    const out = await run(id, S2);
    expect(out.reconcile).toMatchObject({ code: "DUPLICATE_RECORDED" });
    const r = await stored(id);
    expect(r.status).toBe("verificado");
    expect(r.evidence.payment?.signature).toBe(S1);
    expect(r.evidence.duplicates).toEqual([{ signature: S2, commitment: "confirmed", at: new Date(NOW).toISOString() }]);
    expect(r.history).toEqual(before.history);
    expect((await run(id, S2)).reconcile).toMatchObject({ code: "DUPLICATE_RECORDED" });
    expect((await stored(id)).evidence.duplicates).toHaveLength(1);
    // a payment that does not match is not recorded
    chain.add(S3, snap, { amount: 3n });
    expect((await run(id, S3)).reconcile).toMatchObject({ refused: true });
    expect((await stored(id)).evidence.duplicates).toHaveLength(1);
  });

  it("the public receipt page input stays free of names: the stored payment holds keys and numbers only", async () => {
    const { id, snap } = await charge({ description: "secret invoice 42" });
    chain.add(S1, snap);
    await run(id, S1);
    const payment = JSON.stringify((await stored(id)).evidence.payment);
    expect(payment).not.toContain("secret invoice");
    expect(payment).not.toContain("receiver");
  });
});
