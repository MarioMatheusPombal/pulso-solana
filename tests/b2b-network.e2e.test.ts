// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Issue 311: the B2B network end to end against a real validator. Two organizations (A pays, B receives),
// real wallet-style signatures over the server's challenges, the app libs called directly with a temp
// directory (no Next), the agent adapter paying through PULSO, and reconciliation reading the real chain.
// Matrix: tests/README.md, section "B2B network (#311)". Test names carry the matrix ids (T-xx).
// Keys are generated in memory and never printed. Nothing here is authorization: only the program spends.
import { BN } from "@anchor-lang/core";
import { createMint, getAccount, getOrCreateAssociatedTokenAccount, mintTo, transfer, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { createPrivateKey, sign as edSign } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RecordingConnection, executePackage, type Outcome } from "../agent-demo/src/b2b.js";
import { startValidator, type LocalValidator } from "../agent-demo/src/validator.js";
import { computeTermsDigest, findPolicyPda, getProgram, PROGRAM_ID, PulsoClient, type PendingApproval } from "../sdk/src/index.js";
import * as Auth from "../app/lib/network-auth";
import * as Orgs from "../app/lib/network-store-orgs";
import * as Conns from "../app/lib/network-store-connections";
import * as Reqs from "../app/lib/network-requests";
import * as Rec from "../app/lib/network-reconcile";

const T = (n: number) => BigInt(n) * 1_000_000n;
const HOST = "pulso.test";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const signB64 = (k: Keypair, message: string) =>
  edSign(null, Buffer.from(message, "utf8"), createPrivateKey({ key: Buffer.concat([PKCS8, k.secretKey.slice(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");
const pub = (k: Keypair) => k.publicKey.toBase58();
const clone = <X,>(v: X): X => JSON.parse(JSON.stringify(v)) as X;
function ok<X>(r: X): Exclude<X, { error: string }> {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r as Exclude<X, { error: string }>;
}
const fail = (r: unknown) => r as { error: string; status: number; code?: string };

// ---------- world ----------

let v: LocalValidator;
let connection: Connection;
let cluster: string;
let dir: string;
let stateDir: string;
const H = Keypair.generate(); // authority of organization A (payer); owns the policy and the vault
const Rk = Keypair.generate(); // authority of organization B (receiver)
const Ck = Keypair.generate(); // third organization with a perfectly valid session
const AG = Keypair.generate(); // A's payer agent
const Y = Keypair.generate(); // another human with another policy (another organization's money)
const AG2 = Keypair.generate();
let mint: PublicKey;
let recipient: PublicKey; // B's token account (owner = B's authority)
let otherToken: PublicKey; // someone else's token account of the same mint
let vault: PublicKey;
let yVault: PublicKey;
interface Sess { key: Keypair; me: string; token: string }
let A: Sess, B: Sess, C: Sess;

const auth = (now = Date.now()): Auth.AuthDeps => ({ dir, cluster, now });
const orgDeps = (now = Date.now()): Orgs.OrgDeps => ({
  ...auth(now),
  readAccount: async (k) => {
    const i = await connection.getAccountInfo(new PublicKey(k));
    return i && { owner: i.owner.toBase58(), data: i.data };
  },
});
const recDeps = (now = Date.now(), conn: unknown = connection) => ({ dir, now, connection: conn as Rec.ReconcileConnection, commitment: "confirmed" as const });
const bal = async (a: PublicKey) => (await getAccount(connection, a)).amount;
const file = (name: string) => { try { return readFileSync(join(dir, `${name}.json`), "utf8"); } catch { return ""; } };
const requestsFile = () => file("requests");

async function signIn(key: Keypair): Promise<Sess> {
  const ch = ok(await Auth.issueChallenge(auth(), HOST, pub(key)));
  const { token } = ok(await Auth.verifyChallenge(auth(), HOST, ch.nonce, signB64(key, ch.message)));
  const s = await Auth.getSession(auth(), token);
  return { key, me: s!.authority, token };
}

async function setupPolicy(h: Keypair, a: Keypair): Promise<PublicKey> {
  const hp = getProgram(connection, h);
  const policy = findPolicyPda(h.publicKey, a.publicKey);
  // autonomous up to 10 USDC, at most 500 per transaction, 5000 per day
  await hp.methods.createPolicy(new BN(T(500).toString()), new BN(T(5000).toString()), false, new BN(T(10).toString())).accountsPartial({ human: h.publicKey, agent: a.publicKey }).rpc();
  await hp.methods.createVault().accountsPartial({ human: h.publicKey, policy, mint }).rpc();
  const vaultAddress = new PulsoClient({ connection, agent: a, human: h.publicKey }).vault;
  await mintTo(connection, H, mint, vaultAddress, H, T(2000));
  return vaultAddress;
}

async function fund(k: Keypair) {
  await connection.confirmTransaction(await connection.requestAirdrop(k.publicKey, 10 * LAMPORTS_PER_SOL));
}

beforeAll(async () => {
  v = await startValidator({ programId: PROGRAM_ID.toBase58(), soPath: resolve(import.meta.dirname, "../target/deploy/pulso.so"), rpcPort: 8995, faucetPort: 9995 });
  connection = v.connection;
  cluster = await connection.getGenesisHash();
  dir = mkdtempSync(join(tmpdir(), "pulso-b2b-net-"));
  stateDir = mkdtempSync(join(tmpdir(), "pulso-b2b-agent-"));
  for (const k of [H, AG, Y, AG2]) await fund(k);
  mint = await createMint(connection, H, H.publicKey, null, 6);
  recipient = (await getOrCreateAssociatedTokenAccount(connection, H, mint, Rk.publicKey)).address;
  otherToken = (await getOrCreateAssociatedTokenAccount(connection, H, mint, Keypair.generate().publicKey)).address;
  vault = await setupPolicy(H, AG);
  yVault = await setupPolicy(Y, AG2);

  [A, B, C] = await Promise.all([signIn(H), signIn(Rk), signIn(Ck)]);
  ok(await Orgs.createOrganization(orgDeps(), A.me, { handle: "acme_pay", displayName: "Acme Pay (demo)", payerAgent: pub(AG) }));
  ok(await Orgs.createOrganization(orgDeps(), B.me, { handle: "bravo_co", displayName: "Bravo Co (demo)", receivingAccount: recipient.toBase58() }));
  ok(await Orgs.createOrganization(orgDeps(), C.me, { handle: "acrne_pay", displayName: "Acme Pay (demo)" })); // lookalike of A's handle
  await connect(A, B);
}, 240_000);

afterAll(async () => {
  await v?.stop();
  for (const d of [dir, stateDir]) if (d) rmSync(d, { recursive: true, force: true });
});

/** Invite by the inviter and accept by the invited, both signing the server's exact messages. */
async function connect(from: Sess, to: Sess) {
  const p = ok(await Conns.prepareInvite(auth(), HOST, from.me, { authority: to.me }));
  const inv = ok(await Conns.submitInvite(auth(), HOST, from.me, { id: p.id, target: to.me, nonce: p.nonce, signature: signB64(from.key, p.message) }));
  const pa = ok(await Conns.prepareAccept(auth(), HOST, to.me, inv.id));
  return ok(await Conns.accept(auth(), HOST, to.me, inv.id, { nonce: pa.nonce, signature: signB64(to.key, pa.message) }));
}

/** charge: B (receiver) issues. send: A (payer) proposes and B accepts. Returns the request id (= nonce). */
async function create(kind: "charge" | "send", amount: bigint, expirySec = 3600): Promise<string> {
  const [creator, other] = kind === "charge" ? [B, A] : [A, B];
  const expiry = Math.floor(Date.now() / 1000) + expirySec;
  const p = ok(await Reqs.prepareRequest(orgDeps(), HOST, creator.me, { kind, counterparty: other.me, amount: amount.toString(), expiry }));
  const out = ok(await Reqs.submitRequest(orgDeps(), HOST, creator.me, { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(creator.key, p.message) }));
  if (kind === "send") {
    const pa = ok(await Reqs.prepareAccept(auth(), HOST, B.me, out.id));
    ok(await Reqs.acceptRequest(auth(), HOST, B.me, out.id, { nonce: pa.nonce, signature: signB64(B.key, pa.message) }));
  }
  return out.id;
}

const pkgOf = async (id: string, who = A.me) => clone(ok(await Reqs.requestPackage(auth(), who, id)));
const view = async (id: string, who = A.me) => ok(await Reqs.getRequest(auth(), who, id));

// ---------- agent ----------

const humanApproves = async (pending: PendingApproval) => {
  await getProgram(connection, H)
    .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
    .accountsPartial({ authority: H.publicKey, policy: findPolicyPda(H.publicKey, AG.publicKey) })
    .rpc();
};

function pay(pkg: unknown, o: { state?: string; approve?: boolean; onPending?: (p: PendingApproval) => void; fetch?: typeof fetch; waitMs?: number } = {}): Promise<Outcome> {
  const rc = new RecordingConnection(connection.rpcEndpoint, "confirmed");
  return executePackage({
    pkg,
    agent: AG.publicKey,
    connection: rc,
    stateDir: o.state ?? stateDir,
    waitOptions: { timeoutMs: o.waitMs ?? 30_000, initialDelayMs: 200, maxDelayMs: 1_000 },
    makeClient: (human) => new PulsoClient({ connection: rc, agent: AG, human, ...(o.fetch ? { approvalsUrl: "http://backend.invalid", fetch: o.fetch } : {}) }),
    onPause: o.approve || o.onPending ? async (p) => { o.onPending?.(p); if (o.approve) await humanApproves(p); } : undefined,
  });
}
const executed = (o: Outcome) => {
  if (o.status !== "executed") throw new Error("expected executed");
  return o;
};
/** What a misbehaving holder of the agent key can do inside the policy: pay with the request's nonce but its own terms. */
const rogue = (nonceHex: string, amount: bigint, to = recipient) =>
  new PulsoClient({ connection, agent: AG, human: H.publicKey }).execute({ amount, recipient: to, nonce: Buffer.from(nonceHex, "hex") }).then((r) => (r as { signature: string }).signature);

const rec = (who: string, id: string, signature: string, now?: number, conn?: unknown) => Rec.reconcileRequest(recDeps(now, conn), who, id, { signature });
const code = (r: unknown) => (r as { reconcile: { code: string } }).reconcile.code;
const statusOf = (r: unknown) => (r as { request: { status: string } }).request.status;

// ============================================================================================

describe("sessions, impersonation and the agent (T-05, T-07, T-10, T-11, T-04, T-08)", () => {
  it("T-05/T-07 login: replay, expired, wrong cluster and wrong key are refused; the session is the signer's", async () => {
    const ch = ok(await Auth.issueChallenge(auth(), HOST, pub(H)));
    const sig = signB64(H, ch.message);
    ok(await Auth.verifyChallenge(auth(), HOST, ch.nonce, sig));
    expect(await Auth.verifyChallenge(auth(), HOST, ch.nonce, sig)).toMatchObject({ status: 401 }); // replay: consumed

    const old = ok(await Auth.issueChallenge(auth(), HOST, pub(H)));
    expect(await Auth.verifyChallenge(auth(Date.now() + 6 * 60_000), HOST, old.nonce, signB64(H, old.message))).toMatchObject({ status: 401 }); // expired

    const foreign = ok(await Auth.issueChallenge({ ...auth(), cluster: "11111111111111111111111111111111" }, HOST, pub(H)));
    expect(await Auth.verifyChallenge(auth(), HOST, foreign.nonce, signB64(H, foreign.message))).toMatchObject({ status: 401 }); // cluster

    const other = ok(await Auth.issueChallenge(auth(), HOST, pub(H)));
    expect(await Auth.verifyChallenge(auth(), HOST, other.nonce, signB64(Ck, other.message))).toMatchObject({ status: 401 }); // wrong key
    expect(await Auth.verifyChallenge(auth(), HOST, other.nonce, signB64(H, other.message))).toMatchObject({ status: 401 }); // burned by the bad attempt
    expect(A.me).toBe(pub(H));
  });

  it("T-10 cookie, Origin and logout", async () => {
    const s = await signIn(H);
    const req = (headers: Record<string, string>) => new Request(`http://${HOST}/api/network/requests`, { method: "POST", headers: { host: HOST, ...headers } });
    expect(await Auth.requireSession(req({ cookie: `${Auth.SESSION_COOKIE}=${s.token}` }), auth())).toBe(pub(H));
    await expect(Auth.requireSession(req({}), auth())).rejects.toMatchObject({ status: 401 });
    await expect(Auth.requireSession(req({ cookie: `${Auth.SESSION_COOKIE}=${s.token}` }), auth(Date.now() + 9 * 3_600_000))).rejects.toMatchObject({ status: 401 }); // 8h session expired
    expect(() => Auth.requireSameOrigin(req({}))).toThrow(); // no Origin on a POST
    try { Auth.requireSameOrigin(req({ origin: "http://evil.example" })); throw new Error("accepted"); } catch (e) { expect((e as Response).status).toBe(403); }
    Auth.requireSameOrigin(req({ origin: `http://${HOST}` }));
    await Auth.destroySession(auth(), s.token);
    await expect(Auth.requireSession(req({ cookie: `${Auth.SESSION_COOKIE}=${s.token}` }), auth())).rejects.toMatchObject({ status: 401 });
  });

  it("T-11 the agent key is not an administrator: it cannot sign the authority's login, and a session of its own sees nothing of A", async () => {
    // Only the wallet that controls the authority can sign its challenge.
    const ch = ok(await Auth.issueChallenge(auth(), HOST, pub(H)));
    expect(await Auth.verifyChallenge(auth(), HOST, ch.nonce, signB64(AG, ch.message))).toMatchObject({ status: 401 });
    // It CAN sign in as itself (a different authority). That session has no organization and no access to A's data.
    const agent = await signIn(AG);
    expect(agent.me).toBe(pub(AG));
    expect(fail(await Orgs.getOwnOrganization(auth(), agent.me))).toMatchObject({ status: 404 });
    expect(fail(await Orgs.createOrganization(orgDeps(), agent.me, { handle: "agent_org", displayName: "x", payerAgent: pub(AG) }))).toMatchObject({ code: "AGENT_IS_AUTHORITY" });
    expect(fail(await Orgs.updateOrganization(orgDeps(), agent.me, { payerAgent: pub(AG2) }))).toMatchObject({ status: 404 }); // cannot reassign A's agent
    const id = await create("charge", T(5));
    expect(fail(await Reqs.getRequest(auth(), agent.me, id)).status).toBe(404);
    expect(fail(await Reqs.requestPackage(auth(), agent.me, id)).status).toBe(404);
    expect(await Reqs.listRequests(auth(), agent.me)).toEqual([]);
    expect(await Conns.listConnections(auth(), agent.me)).toEqual([]);
  });

  it("T-04/T-08/T-18 a lookalike handle is a different organization with its own key; search leaks nothing else", async () => {
    expect(await Orgs.findOrganization(auth(), { handle: "acme_pay" })).toEqual({ handle: "acme_pay", displayName: "Acme Pay (demo)", authority: pub(H) });
    expect(await Orgs.findOrganization(auth(), { handle: "@ACRNE_PAY " })).toEqual({ handle: "acrne_pay", displayName: "Acme Pay (demo)", authority: pub(Ck) });
    expect(fail(await Orgs.createOrganization(orgDeps(), pub(Keypair.generate()), { handle: "acme_pay", displayName: "x" }))).toMatchObject({ code: "HANDLE_TAKEN" });
    expect(fail(await Orgs.createOrganization(orgDeps(), pub(Keypair.generate()), { handle: "аcme_pay", displayName: "x" }))).toMatchObject({ code: "INVALID_HANDLE" }); // Cyrillic "а"
    // the invite shows the full key of the target before anyone signs
    const p = ok(await Conns.prepareInvite(auth(), HOST, A.me, { handle: "acrne_pay" }));
    expect(p.target.authority).toBe(pub(Ck));
    expect(p.message).toContain(`pulso-connection-v1:${pub(H)}:${pub(Ck)}:`);
  });
});

describe("consent and invitations cannot be forged (T-13, T-14, T-19, T-20, T-23)", () => {
  it("T-13/T-14 invite: wrong signer, replay, other action; accept by a third party, with a forged signature, and replay", async () => {
    const before = file("connections");
    const p = ok(await Conns.prepareInvite(auth(), HOST, A.me, { authority: C.me }));
    const forged = { id: p.id, target: C.me, nonce: p.nonce, signature: signB64(AG, p.message) }; // the agent key signs A's invite
    expect(fail(await Conns.submitInvite(auth(), HOST, A.me, forged)).status).toBe(401);
    expect(file("connections")).toBe(before);

    const p2 = ok(await Conns.prepareInvite(auth(), HOST, A.me, { authority: C.me }));
    const sig = signB64(H, p2.message);
    const inv = ok(await Conns.submitInvite(auth(), HOST, A.me, { id: p2.id, target: C.me, nonce: p2.nonce, signature: sig }));
    expect(fail(await Conns.submitInvite(auth(), HOST, A.me, { id: p2.id, target: C.me, nonce: p2.nonce, signature: sig })).status).toBe(401); // replay
    expect((await Conns.listConnections(auth(), A.me)).filter((c) => c.counterparty && "authority" in c.counterparty && c.counterparty.authority === C.me)).toHaveLength(1);

    expect(fail(await Conns.prepareAccept(auth(), HOST, B.me, inv.id)).status).toBe(404); // B is not a participant of A<->C
    const pa = ok(await Conns.prepareAccept(auth(), HOST, C.me, inv.id));
    expect(fail(await Conns.accept(auth(), HOST, C.me, inv.id, { nonce: pa.nonce, signature: signB64(H, pa.message) })).status).toBe(401); // signed by A, not C
    expect((await Conns.listConnections(auth(), C.me))[0].status).toBe("pendente");
    // the nonce above was burned by the bad attempt; a fresh one for the real signer works
    const pb = ok(await Conns.prepareAccept(auth(), HOST, C.me, inv.id));
    expect(ok(await Conns.accept(auth(), HOST, C.me, inv.id, { nonce: pb.nonce, signature: signB64(Ck, pb.message) })).status).toBe("ativa");
  });

  it("T-19/T-23 charge: tampered snapshot, forged signer, replay, another request's signature, client-sent status", async () => {
    const mk = async (amount = T(5)) => ok(await Reqs.prepareRequest(orgDeps(), HOST, B.me, { kind: "charge", counterparty: A.me, amount: amount.toString(), expiry: Math.floor(Date.now() / 1000) + 3600 }));
    const submit = (p: Awaited<ReturnType<typeof mk>>, signature: string, snapshot: unknown = p.snapshot, me = B.me, extra: object = {}) =>
      Reqs.submitRequest(orgDeps(), HOST, me, { snapshot, nonce: p.nonce, signature, ...extra });
    const before = requestsFile();

    // Terms are bound to the digest the receiver signed: a bigger amount is another digest, so the signature does not carry over.
    const p1 = await mk();
    expect(fail(await submit(p1, signB64(Rk, p1.message), { ...p1.snapshot, amount: T(900).toString() })).status).toBe(401);
    // Destination, mint, cluster and agent come from the server's own reading of the chain: the client cannot choose them.
    for (const field of ["recipientTokenAccount", "mint", "genesis", "agent", "policy"] as const) {
      const p = await mk();
      const swapped = { ...p.snapshot, [field]: field === "genesis" ? "11111111111111111111111111111111" : pub(Keypair.generate()) };
      expect(fail(await submit(p, signB64(Rk, p.message), swapped))).toMatchObject({ status: 400, code: "SNAPSHOT_MISMATCH" });
    }
    const p2 = await mk();
    expect(fail(await submit(p2, signB64(Rk, p2.message), p2.snapshot, C.me)).status).toBe(403); // C is not the receiver
    expect(fail(await submit(p2, signB64(Ck, p2.message))).status).toBe(401); // signed by C, submitted as B
    expect(requestsFile()).toBe(before); // nothing was created by any of this

    const p3 = await mk();
    const good = signB64(Rk, p3.message);
    const created = ok(await submit(p3, good, p3.snapshot, B.me, { status: "verificado", mode: "aprovado" })); // client-sent status is ignored
    expect(created.status).toBe("aguardando autorização");
    expect(fail(await submit(p3, good)).status).toBe(401); // replay of the same consent
    const p4 = await mk();
    expect(fail(await submit(p4, good)).status).toBe(401); // another request's signature on this nonce
    expect(JSON.parse(requestsFile()).items).toHaveLength(JSON.parse(before || '{"items":[]}').items.length + 1);
  });

  it("T-20 proposal: no payment path before the receiver signs; accept by the payer, or with another digest, is refused", async () => {
    const p = ok(await Reqs.prepareRequest(orgDeps(), HOST, A.me, { kind: "send", counterparty: B.me, amount: T(5).toString(), expiry: Math.floor(Date.now() / 1000) + 3600 }));
    const out = ok(await Reqs.submitRequest(orgDeps(), HOST, A.me, { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(H, p.message) }));
    expect((await pkgOf(out.id)).ready).toBe(false);
    expect(out.status).toBe("aguardando contraparte");
    expect(fail(await Reqs.prepareAccept(auth(), HOST, A.me, out.id)).status).toBe(403);
    // B's accept signed for the proposal above does not carry over to another digest
    const q = ok(await Reqs.prepareRequest(orgDeps(), HOST, A.me, { kind: "send", counterparty: B.me, amount: T(7).toString(), expiry: Math.floor(Date.now() / 1000) + 3600 }));
    const q1 = ok(await Reqs.submitRequest(orgDeps(), HOST, A.me, { snapshot: q.snapshot, nonce: q.nonce, signature: signB64(H, q.message) }));
    const forAnother = ok(await Reqs.prepareAccept(auth(), HOST, B.me, out.id));
    expect(fail(await Reqs.acceptRequest(auth(), HOST, B.me, q1.id, { nonce: forAnother.nonce, signature: signB64(Rk, forAnother.message) })).status).toBe(401);
    expect((await view(q1.id)).status).toBe("aguardando contraparte");
    const right = ok(await Reqs.prepareAccept(auth(), HOST, B.me, out.id));
    ok(await Reqs.acceptRequest(auth(), HOST, B.me, out.id, { nonce: right.nonce, signature: signB64(Rk, right.message) }));
    expect((await pkgOf(out.id)).ready).toBe(true);
  });
});

describe("isolation between organizations: IDOR (T-17)", () => {
  it("C has a valid session and an active connection with A, and still gets 404 on everything of A<->B", async () => {
    const id = await create("charge", T(5));
    const [pre, preConn] = [requestsFile(), file("connections")];
    const nonceOfNothing = signB64(Ck, "irrelevant");
    const results = await Promise.all([
      Reqs.getRequest(auth(), C.me, id),
      Reqs.requestPackage(auth(), C.me, id),
      Reqs.declineRequest(auth(), C.me, id),
      Reqs.cancelRequest(auth(), C.me, id),
      Reqs.prepareAccept(auth(), HOST, C.me, id),
      Reqs.acceptRequest(auth(), HOST, C.me, id, { nonce: "x".repeat(43), signature: nonceOfNothing }),
      Rec.getReconciliation(auth(), C.me, id),
      Rec.reconcileRequest(recDeps(), C.me, id, { signature: "1".repeat(88) }),
    ]);
    for (const r of results) expect(fail(r).status).toBe(404);
    expect(await Reqs.listRequests(auth(), C.me)).toEqual([]);
    // connection A<->B: C cannot see, accept, decline, cancel or disconnect it
    const ab = (await Conns.listConnections(auth(), A.me)).find((c) => "handle" in c.counterparty && c.counterparty.handle === "bravo_co")!;
    expect((await Conns.listConnections(auth(), C.me)).some((c) => c.id === ab.id)).toBe(false);
    for (const act of [Conns.decline, Conns.cancel, Conns.disconnect]) expect(fail(await act(auth(), C.me, ab.id)).status).toBe(404);
    expect(requestsFile()).toBe(pre);
    expect(file("connections")).toBe(preConn);
    // C cannot open a request towards B either: no active connection between them
    expect(fail(await Reqs.prepareRequest(orgDeps(), HOST, C.me, { kind: "charge", counterparty: B.me, amount: "1000000", expiry: Math.floor(Date.now() / 1000) + 60 })).code).toBe("NO_ACTIVE_CONNECTION");
  });
});

describe("a valid payment verifies, and cannot be verified twice (T-26, T-35, T-36)", () => {
  it("T-26 autonomous: charge paid by the agent is verificado with both sides of the evidence; the SPL balances moved by exactly the amount", async () => {
    const id = await create("charge", T(5));
    const [v0, r0] = [await bal(vault), await bal(recipient)];
    const signature = executed(await pay(await pkgOf(id))).signature;
    expect(v0 - (await bal(vault))).toBe(T(5));
    expect((await bal(recipient)) - r0).toBe(T(5));
    const out = await rec(B.me, id, signature); // the receiver reconciles
    expect(code(out)).toBe("VERIFIED");
    const r = await view(id);
    expect(r.status).toBe("verificado");
    expect(r.evidence.payment).toMatchObject({ signature, mode: "autônomo", commitment: "confirmed" });
    expect(r.evidence.payment!.receipt).toMatchObject({ amount: T(5).toString(), nonce: id, human: pub(H), agent: pub(AG), recipient: recipient.toBase58() });
    expect(r.evidence.consent.map((c) => c.action)).toEqual(["network.charge.issue"]);
    expect(r.evidence.consent[0].terms).toBe(r.digest);
    expect(statusOf(await rec(A.me, id, signature))).toBe("verificado"); // the payer sees the same, idempotent
  });

  it("T-26/T-36 approved: proposal paid after the on-chain intent; the second execution is refused by the program and the vault stays", async () => {
    const id = await create("send", T(100));
    const [v0, r0] = [await bal(vault), await bal(recipient)];
    let pending!: PendingApproval;
    expect(await pay(await pkgOf(id))).toMatchObject({ status: "paused" }); // no approver: nothing leaves
    expect(await bal(vault)).toBe(v0);
    const signature = executed(await pay(await pkgOf(id), { approve: true, onPending: (p) => (pending = p) })).signature;
    expect(v0 - (await bal(vault))).toBe(T(100));
    expect((await bal(recipient)) - r0).toBe(T(100));
    expect(await rec(A.me, id, signature)).toMatchObject({ reconcile: { code: "VERIFIED" } });
    const r = await view(id);
    expect(r.evidence.payment).toMatchObject({ mode: "aprovado" });
    expect(r.evidence.payment!.intent).toBeTruthy();
    expect(r.evidence.payment!.actionHash).toBeTruthy();
    expect(r.evidence.consent.map((c) => c.action)).toEqual(["network.send.propose", "network.send.accept"]);

    // T-36: repeating the approved execution is a program refusal (PULSO_005_INTENT_ALREADY_USED)
    const rc = new RecordingConnection(connection.rpcEndpoint, "confirmed");
    const again = await new PulsoClient({ connection: rc, agent: AG, human: H.publicKey }).executeApproved(pending).catch((e: Error) => e);
    expect(String((again as Error).message)).toContain("PULSO_005_INTENT_ALREADY_USED");
    expect(v0 - (await bal(vault))).toBe(T(100));
  });

  it("T-35 autonomous branch, THE DECLARED LIMIT: nothing on-chain stops a second execution with the same nonce; the request records it as duplicate and the money is gone", async () => {
    const id = await create("charge", T(5));
    const pkg = await pkgOf(id);
    const v0 = await bal(vault);
    const first = executed(await pay(pkg));
    // The adapter keeps one signature per request in a local state file (client-side only):
    expect(executed(await pay(pkg))).toMatchObject({ signature: first.signature, alreadySent: true });
    expect(v0 - (await bal(vault))).toBe(T(5));
    // Another process, another machine or a deleted state file: the program takes it. The program only carries the nonce.
    const second = executed(await pay(pkg, { state: mkdtempSync(join(tmpdir(), "pulso-b2b-agent2-")) }));
    expect(second.signature).not.toBe(first.signature);
    expect(v0 - (await bal(vault))).toBe(T(10)); // paid twice, on-chain
    expect(code(await rec(A.me, id, first.signature))).toBe("VERIFIED");
    expect(code(await rec(A.me, id, second.signature))).toBe("DUPLICATE_RECORDED"); // the app tells the truth; it cannot give the money back
    const r = await view(id);
    expect(r.status).toBe("verificado");
    expect(r.evidence.payment!.signature).toBe(first.signature);
    expect(r.evidence.duplicates).toHaveLength(1);
    expect(r.evidence.duplicates![0].signature).toBe(second.signature);
  });
});

describe("attacks on the payment: the request is not satisfied, state unchanged (T-27..T-30, T-32)", () => {
  const untouched = async (id: string, reasonStartsWith: string) => {
    const r = await view(id);
    expect(r.status).toBe("aguardando autorização");
    expect(r.signature).toBeNull();
    expect(r.evidence.payment).toBeUndefined();
    expect(r.attempts.at(-1)!.reason.startsWith(reasonStartsWith)).toBe(true);
  };

  it("T-30 the agent cannot move the vault with a plain SPL transfer", async () => {
    const v0 = await bal(vault);
    await expect(transfer(connection, AG, vault, otherToken, AG, T(5))).rejects.toThrow();
    expect(await bal(vault)).toBe(v0);
  });

  it("T-30 a direct SPL transfer outside the program, same amount to the same account, does not satisfy the request (the money did arrive)", async () => {
    const id = await create("charge", T(5));
    const agentAta = (await getOrCreateAssociatedTokenAccount(connection, AG, mint, AG.publicKey)).address;
    await mintTo(connection, H, mint, agentAta, H, T(50));
    const r0 = await bal(recipient);
    const direct = await transfer(connection, AG, agentAta, recipient, AG, T(5));
    expect((await bal(recipient)) - r0).toBe(T(5));
    const out = await rec(A.me, id, direct);
    expect(out).toMatchObject({ reconcile: { code: "NOT_PULSO_TRANSFER", refused: true } });
    await untouched(id, "NOT_PULSO_TRANSFER");
  });

  it("T-27/T-32 receipt of ANOTHER charge: NONCE_MISMATCH; and once the real owner is verified the same signature is SIGNATURE_IN_USE elsewhere", async () => {
    const [one, two, three] = [await create("charge", T(5)), await create("charge", T(5)), await create("charge", T(5))];
    const signature = executed(await pay(await pkgOf(one))).signature;
    const v0 = await bal(vault);
    expect(await rec(A.me, two, signature)).toMatchObject({ reconcile: { code: "NONCE_MISMATCH", refused: true } });
    await untouched(two, "NONCE_MISMATCH");
    expect(code(await rec(B.me, one, signature))).toBe("VERIFIED");
    const clash = fail(await rec(A.me, three, signature));
    expect(clash).toMatchObject({ status: 409, code: "SIGNATURE_IN_USE" });
    expect((await view(three)).status).toBe("aguardando autorização");
    expect(await bal(vault)).toBe(v0); // verifying spends nothing
  });

  it("T-28 more than the exact amount is AMOUNT_NOT_EXACT, less is AMOUNT_TOO_LOW (a holder of the agent key stays inside the policy; the request does not follow it)", async () => {
    const [more, less] = [await create("charge", T(5)), await create("charge", T(5))];
    const sigMore = await rogue(more, T(7));
    const sigLess = await rogue(less, T(3));
    expect(await rec(A.me, more, sigMore)).toMatchObject({ reconcile: { code: "AMOUNT_NOT_EXACT" } });
    expect(await rec(A.me, less, sigLess)).toMatchObject({ reconcile: { code: "AMOUNT_TOO_LOW" } });
    await untouched(more, "AMOUNT_NOT_EXACT");
    await untouched(less, "AMOUNT_TOO_LOW");
  });

  it("T-29 another destination account, another human's policy and another cluster do not satisfy the request", async () => {
    const [dest, human, clust] = [await create("charge", T(5)), await create("charge", T(5)), await create("charge", T(5))];
    expect(await rec(A.me, dest, await rogue(dest, T(5), otherToken))).toMatchObject({ reconcile: { code: "RECIPIENT_MISMATCH" } });
    await untouched(dest, "RECIPIENT_MISMATCH");

    // Y's own policy and vault (other organization's money) pays B's account with this request's nonce
    const y = await new PulsoClient({ connection, agent: AG2, human: Y.publicKey }).execute({ amount: T(5), recipient, nonce: Buffer.from(human, "hex") });
    expect(await bal(yVault)).toBe(T(2000) - T(5));
    expect(await rec(A.me, human, (y as { signature: string }).signature)).toMatchObject({ reconcile: { code: "AUTHORITY_NOT_ACCEPTED" } });
    await untouched(human, "AUTHORITY_NOT_ACCEPTED");

    const real = executed(await pay(await pkgOf(clust))).signature;
    const wrongRpc = new Proxy(connection, { get: (t, p) => (p === "getGenesisHash" ? async () => "11111111111111111111111111111111" : typeof (t as never)[p] === "function" ? ((t as never)[p] as Function).bind(t) : (t as never)[p]) });
    // The server's RPC on another cluster is a server setting: nothing is recorded and the same signature verifies once it is fixed.
    expect(await rec(A.me, clust, real, undefined, wrongRpc)).toMatchObject({ reconcile: { code: "CLUSTER_MISMATCH", refused: false, retry: true } });
    expect((await view(clust)).attempts).toEqual([]);
    expect(await rec(A.me, clust, real)).toMatchObject({ reconcile: { code: "VERIFIED" } });
  });

  it("T-23 a made-up status and a made-up result do nothing: only the signature is read, and an unknown one leaves the request `enviado`", async () => {
    const id = await create("charge", T(5));
    const fake = "2".repeat(88);
    const out = ok(await Rec.reconcileRequest(recDeps(), A.me, id, { signature: fake, status: "verificado", amount: "5000000", mode: "approved", result: "VERIFIED" } as never));
    expect(out.reconcile).toMatchObject({ code: "TX_NOT_FOUND", retry: true });
    expect(out.request.status).toBe("enviado"); // never green
  });

  it("T-31 RPC down: the request is not verified and stays `enviado`; with the RPC back it verifies", async () => {
    const id = await create("charge", T(5));
    const signature = executed(await pay(await pkgOf(id))).signature;
    const dead = new Connection("http://127.0.0.1:1", "confirmed");
    const out = await rec(A.me, id, signature, undefined, dead);
    expect(out).toMatchObject({ reconcile: { code: "RPC_ERROR", retry: true } });
    expect(statusOf(out)).toBe("enviado");
    expect(code(await rec(A.me, id, signature))).toBe("VERIFIED");
  });
});

describe("the agent does not spend on a bad package or a lying backend (T-37)", () => {
  it("tampered amount, destination or nonce, even with a recomputed digest: refused before any transaction; vault unchanged", async () => {
    const id = await create("charge", T(5));
    const good = await pkgOf(id);
    const v0 = await bal(vault);
    const digestOf = (s: typeof good.snapshot) =>
      Buffer.from(computeTermsDigest({
        kind: s.kind, genesis: new PublicKey(s.genesis).toBytes(), programId: new PublicKey(s.programId), policy: new PublicKey(s.policy), payerAuthority: new PublicKey(s.payerAuthority),
        agent: new PublicKey(s.agent), mint: new PublicKey(s.mint), recipientTokenAccount: new PublicKey(s.recipientTokenAccount), receiverAuthority: new PublicKey(s.receiverAuthority),
        amount: BigInt(s.amount), nonce: Buffer.from(s.nonce, "hex"), expiry: BigInt(s.expiry),
      })).toString("hex");
    const edits: [string, (p: typeof good) => void][] = [
      ["amount", (p) => { p.snapshot.amount = T(400).toString(); }],
      ["recipient", (p) => { p.snapshot.recipientTokenAccount = otherToken.toBase58(); }],
      ["nonce", (p) => { p.snapshot.nonce = "00".repeat(16); p.requestId = p.snapshot.nonce; }],
      ["recipient + honest digest", (p) => { p.snapshot.recipientTokenAccount = otherToken.toBase58(); p.digest = digestOf(p.snapshot); }],
      ["amount + honest digest", (p) => { p.snapshot.amount = T(400).toString(); p.digest = digestOf(p.snapshot); }],
    ];
    for (const [name, edit] of edits) {
      const bad = clone(good);
      edit(bad);
      const err = await pay(bad).catch((e: unknown) => e);
      expect(err, name).toBeInstanceOf(Error);
      expect((err as { code?: string }).code, name).toMatch(/MISMATCH/); // DIGEST_MISMATCH, REQUEST_ID_MISMATCH or CONSENT_TERMS_MISMATCH
    }
    expect(await bal(vault)).toBe(v0);
  });

  it("a backend that says `approved` without an on-chain intent authorizes nothing", async () => {
    const id = await create("send", T(100));
    const v0 = await bal(vault);
    const liar = (async () => new Response(JSON.stringify({ status: "approved" }), { status: 200, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
    let pending!: PendingApproval;
    const err = await pay(await pkgOf(id), { fetch: liar, onPending: (p) => (pending = p), waitMs: 2_000 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error); // times out waiting for the chain
    expect(await bal(vault)).toBe(v0);
    // And repeating the "approved" action directly: no intent account, the program refuses
    const direct = await new PulsoClient({ connection, agent: AG, human: H.publicKey }).executeApproved(pending).catch((e: Error) => e);
    expect(direct).toBeInstanceOf(Error);
    expect(await bal(vault)).toBe(v0);
    expect((await view(id)).status).toBe("aguardando autorização");
  });
});

describe("concurrency, retries and restart (T-16, T-32, T-33)", () => {
  it("T-32/T-33 four parallel reconciliations of one signature, by both participants: one verification, no duplicate", async () => {
    const id = await create("charge", T(5));
    const signature = executed(await pay(await pkgOf(id))).signature;
    const outs = await Promise.all([rec(A.me, id, signature), rec(B.me, id, signature), rec(A.me, id, signature), rec(B.me, id, signature)]);
    for (const o of outs) expect(statusOf(o)).toBe("verificado");
    const r = await view(id);
    expect(r.history.filter((h) => h.to === "verificado")).toHaveLength(1);
    expect(r.evidence.duplicates).toBeUndefined();
    expect(r.evidence.payment!.signature).toBe(signature);
  });

  it("T-32 the same signature reported at the same time on its own request and on another: the other never verifies, the owner ends verified", async () => {
    const [mine, theirs] = [await create("charge", T(5)), await create("charge", T(5))];
    const signature = executed(await pay(await pkgOf(mine))).signature;
    await Promise.all([rec(A.me, theirs, signature), rec(B.me, mine, signature)]);
    for (let i = 0; i < 3 && (await view(mine)).status !== "verificado"; i += 1) await rec(B.me, mine, signature); // a loser of the race retries
    expect((await view(mine)).status).toBe("verificado");
    expect((await view(theirs)).status).not.toBe("verificado");
    expect((await view(theirs)).evidence.payment).toBeUndefined();
  });

  it("T-16/T-33 restart between consent, payment, report and reconciliation: fresh module instances and a new agent process over the same directories", async () => {
    const reopen = async () => {
      vi.resetModules();
      const [reqs, rcn] = await Promise.all([import("../app/lib/network-requests"), import("../app/lib/network-reconcile")]);
      return { reqs, rcn };
    };
    // proposal signed by A
    const expiry = Math.floor(Date.now() / 1000) + 3600;
    const p = ok(await Reqs.prepareRequest(orgDeps(), HOST, A.me, { kind: "send", counterparty: B.me, amount: T(5).toString(), expiry }));
    const created = ok(await Reqs.submitRequest(orgDeps(), HOST, A.me, { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(H, p.message) }));
    // restart 1: B accepts
    let m = await reopen();
    const pa = ok(await m.reqs.prepareAccept(auth(), HOST, B.me, created.id));
    expect(ok(await m.reqs.acceptRequest(auth(), HOST, B.me, created.id, { nonce: pa.nonce, signature: signB64(Rk, pa.message) })).status).toBe("aguardando autorização");
    // restart 2: agent pays, process dies, new process with the same state dir does not pay again
    m = await reopen();
    const pkg = clone(ok(await m.reqs.requestPackage(auth(), A.me, created.id)));
    const v0 = await bal(vault);
    const signature = executed(await pay(pkg)).signature;
    expect(executed(await pay(pkg))).toMatchObject({ signature, alreadySent: true });
    expect(v0 - (await bal(vault))).toBe(T(5));
    // restart 3: report while the RPC is down -> enviado survives
    m = await reopen();
    const down = ok(await m.rcn.reconcileRequest(recDeps(Date.now(), new Connection("http://127.0.0.1:1", "confirmed")), A.me, created.id, { signature }));
    expect(down.request.status).toBe("enviado");
    // restart 4: reconcile -> verificado; restart 5: again -> same result, one payment
    m = await reopen();
    expect(ok(await m.rcn.reconcileRequest(recDeps(), B.me, created.id, { signature })).request.status).toBe("verificado");
    m = await reopen();
    const again = ok(await m.rcn.reconcileRequest(recDeps(), A.me, created.id, { signature }));
    expect(again.reconcile).toMatchObject({ code: "VERIFIED" });
    const r = await view(created.id);
    expect(r.history.filter((h) => h.to === "verificado")).toHaveLength(1);
    expect(r.evidence.duplicates).toBeUndefined();
  });
});

describe("cancel and late payment: documented behavior (T-34, T-25)", () => {
  it("T-34 cancelled, then paid: the program does not know the request, the transfer happens; the request stays cancelado and records the fact as late, never as accepted", async () => {
    const id = await create("charge", T(5));
    const pkg = await pkgOf(id); // exported before the cancellation
    expect(ok(await Reqs.cancelRequest(auth(), B.me, id)).status).toBe("cancelado");
    const afterCancel = await pkgOf(id);
    expect(afterCancel.ready).toBe(false); // the package says so; the agent adapter does not read `ready` (b2b-package.ts): cancelling does not stop it
    const [v0, r0] = [await bal(vault), await bal(recipient)];
    const signature = executed(await pay(pkg)).signature;
    expect(v0 - (await bal(vault))).toBe(T(5));
    expect((await bal(recipient)) - r0).toBe(T(5)); // money moved
    const out = await rec(A.me, id, signature);
    expect(out).toMatchObject({ reconcile: { code: "LATE_RECORDED" } });
    const r = await view(id);
    expect(r.status).toBe("cancelado");
    expect(r.late).toMatchObject({ reason: "after_cancel", signature, verified: true });
    expect(r.evidence.payment).toBeUndefined(); // no acceptance
  });

  it("T-25/T-34 expired, then paid: same, with reason after_expiry", async () => {
    const id = await create("charge", T(5));
    const signature = executed(await pay(await pkgOf(id))).signature; // paid in time, but nobody reported it before the deadline
    const later = Date.now() + 2 * 3_600_000;
    const out = await rec(A.me, id, signature, later);
    expect(out).toMatchObject({ reconcile: { code: "LATE_RECORDED" } });
    const r = ok(await Reqs.getRequest({ dir, now: later }, A.me, id));
    expect(r.status).toBe("expirado");
    expect(r.late).toMatchObject({ reason: "after_expiry", signature, verified: true });
    expect(r.evidence.payment).toBeUndefined();
  });
});

describe("the real route handlers: session, Origin and isolation as the HTTP layer applies them (T-10, T-17)", () => {
  it("login through the routes sets an HttpOnly SameSite=Strict cookie; a third party gets 404 on A<->B's request, no cookie 401, a foreign Origin 403", async () => {
    // The handlers read the directory and the RPC from the environment, like in production. Fresh modules pick it up.
    vi.resetModules();
    process.env.PULSO_NETWORK_DIR = dir;
    process.env.NEXT_PUBLIC_RPC_URL = connection.rpcEndpoint;
    const [challenge, verify, item, pkg, receipt, list] = await Promise.all([
      import("../app/app/api/network/auth/challenge/route"),
      import("../app/app/api/network/auth/verify/route"),
      import("../app/app/api/network/requests/[id]/route"),
      import("../app/app/api/network/requests/[id]/package/route"),
      import("../app/app/api/network/requests/[id]/receipt/route"),
      import("../app/app/api/network/requests/route"),
    ]);
    const url = (path: string) => `http://${HOST}${path}`;
    const post = (path: string, body: object, headers: Record<string, string> = {}) =>
      new Request(url(path), { method: "POST", headers: { origin: `http://${HOST}`, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const get = (path: string, cookie?: string) => new Request(url(path), { headers: cookie ? { cookie } : {} });

    // sign in as a brand new wallet, only through the routes
    const w = Keypair.generate();
    const ch = (await (await challenge.POST(post("/api/network/auth/challenge", { authority: pub(w) }))).json()) as { message: string; nonce: string };
    const res = await verify.POST(post("/api/network/auth/verify", { nonce: ch.nonce, signature: signB64(w, ch.message) }));
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect(await res.json()).toMatchObject({ authority: pub(w) });
    expect((await challenge.POST(post("/api/network/auth/challenge", { authority: pub(w) }, { origin: "http://evil.example" }))).status).toBe(403);

    const id = await create("charge", T(5));
    const cookieOf = (s: Sess) => `${Auth.SESSION_COOKIE}=${s.token}`;
    const ctx = { params: Promise.resolve({ id }) };
    expect((await item.GET(get(`/api/network/requests/${id}`, cookieOf(A)), ctx)).status).toBe(200);
    expect((await item.GET(get(`/api/network/requests/${id}`, cookieOf(B)), ctx)).status).toBe(200);
    for (const s of [C, { token: setCookie.split(";")[0].split("=")[1] } as Sess]) {
      expect((await item.GET(get(`/api/network/requests/${id}`, cookieOf(s)), ctx)).status).toBe(404);
      expect((await pkg.GET(get(`/api/network/requests/${id}/package`, cookieOf(s)), ctx)).status).toBe(404);
      expect((await receipt.GET(get(`/api/network/requests/${id}/receipt`, cookieOf(s)), ctx)).status).toBe(404);
      expect((await receipt.POST(post(`/api/network/requests/${id}/receipt`, { signature: "1".repeat(88) }, { cookie: cookieOf(s) }), ctx)).status).toBe(404);
    }
    expect(await (await list.GET(get("/api/network/requests", cookieOf(C)))).json()).toEqual({ requests: [] });
    expect((await item.GET(get(`/api/network/requests/${id}`), ctx)).status).toBe(401); // no cookie
    expect((await receipt.POST(post(`/api/network/requests/${id}/receipt`, { signature: "1".repeat(88) }, { cookie: cookieOf(A), origin: "http://evil.example" }), ctx)).status).toBe(403);
    const noOrigin = new Request(url(`/api/network/requests/${id}/receipt`), { method: "POST", headers: { cookie: cookieOf(A) }, body: "{}" });
    expect((await receipt.POST(noOrigin, ctx)).status).toBe(403);
    expect(((await (await pkg.GET(get(`/api/network/requests/${id}/package`, cookieOf(A)), ctx)).json()) as { ready: boolean }).ready).toBe(true);
    delete process.env.PULSO_NETWORK_DIR;
    delete process.env.NEXT_PUBLIC_RPC_URL;
  });
});

describe("no secret in anything stored or exported (T-39)", () => {
  it("keys, seeds and raw session tokens appear in no stored file, agent state file or package", async () => {
    const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
    const base58 = (bytes: Uint8Array) => {
      let n = BigInt("0x" + Buffer.from(bytes).toString("hex"));
      let s = "";
      while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
      return s;
    };
    const secrets: string[] = [];
    for (const k of [H, Rk, Ck, AG, Y, AG2]) {
      for (const bytes of [k.secretKey, k.secretKey.slice(0, 32)]) {
        secrets.push(Buffer.from(bytes).toString("hex"), Buffer.from(bytes).toString("base64"), base58(bytes), JSON.stringify(Array.from(bytes)));
      }
    }
    secrets.push(A.token, B.token, C.token);
    const texts = [...readdirSync(dir).map((f) => readFileSync(join(dir, f), "utf8")), ...readdirSync(stateDir).map((f) => readFileSync(join(stateDir, f), "utf8")), JSON.stringify(await pkgOf(await create("charge", T(5))))];
    for (const text of texts) for (const s of secrets) expect(text.includes(s)).toBe(false);
  });
});

describe("what the network UI claims (T-40)", () => {
  it("the network screens never claim KYC, a bilateral veto, mainnet, audit or a verified company", () => {
    const root = resolve(import.meta.dirname, "../app");
    const files = [
      "app/network/page.tsx", "app/network/requests/[id]/page.tsx",
      ...readdirSync(join(root, "components")).filter((f) => /^Network.*\.tsx$/.test(f)).map((f) => `components/${f}`),
    ];
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const text = readFileSync(join(root, f), "utf8").replace(/NOT AUDITED/g, "");
      expect(text, f).not.toMatch(/\bKYC\b|\bveto\b|mainnet|audited|auditad|verified (company|business)|empresa verificada/i);
    }
  });
});
