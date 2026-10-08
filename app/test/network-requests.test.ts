import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivateKey, createPublicKey, createHash, sign, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair, PublicKey } from "@solana/web3.js";
import { PROGRAM_ID, findPolicyPda, findVaultPda } from "@pulso/sdk/src/pda.js";
import { computeTermsDigest } from "@pulso/sdk/src/b2b-terms.js";
import { issueConsentChallenge, type ConsentEvidence } from "../lib/network-auth";
import { mutateCollection, readCollection } from "../lib/network-store";
import { TOKEN_PROGRAM_ID, createOrganization, updateOrganization, type AccountData, type OrgDeps } from "../lib/network-store-orgs";
import { disconnect, prepareAccept as prepareConnAccept, accept as acceptConn, prepareInvite, submitInvite } from "../lib/network-store-connections";
import {
  REQUESTS, SYSTEM, acceptRequest, applyTransition, cancelRequest, declineRequest, digestOf, getRequest, listRequests, prepareAccept, prepareRequest,
  requestPackage, submitRequest, systemTransition, type B2BRequest, type Outcome, type Snapshot, type Status, type TransitionEvent,
} from "../lib/network-requests";

const HOST = "pulso.test";
const CLUSTER = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const NOW = 1_800_000_000_000;
const EXP = String(NOW / 1000 + 86_400);
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const signB64 = (kp: Keypair, message: string) =>
  sign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, kp.secretKey.slice(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");
const vectors = JSON.parse(readFileSync(fileURLToPath(new URL("../../tests/vectors/b2b_terms.json", import.meta.url)), "utf8")).vectors as any[];

const ok = <T,>(r: T): Exclude<T, { error: string }> => {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r as Exclude<T, { error: string }>;
};
const rq = (o: Outcome): B2BRequest => { if (!o.ok || !o.request) throw new Error(`unexpected failure: ${JSON.stringify(o)}`); return o.request; };
const status = (r: unknown) => (r as { status: number }).status;
const code = (r: unknown) => (r as { code: string }).code;
const pub = (kp: Keypair) => kp.publicKey.toBase58();

/** 165-byte SPL token account: mint 0..32, owner 32..64, state byte 108. */
function tokenAccount(mint: Keypair, owner: Keypair): Uint8Array {
  const data = new Uint8Array(165);
  data.set(mint.publicKey.toBytes(), 0);
  data.set(owner.publicKey.toBytes(), 32);
  data[108] = 1;
  return data;
}
const policyData = () => Uint8Array.from([...createHash("sha256").update("account:AgentPolicy").digest().subarray(0, 8), ...new Array(40).fill(0)]);

let dir: string;
let accounts: Map<string, AccountData>;
let rpcDown: boolean;
let deps: OrgDeps;
const P = Keypair.generate(); // payer organization authority
const R = Keypair.generate(); // receiver organization authority
const X = Keypair.generate(); // third party
const AGENT = Keypair.generate();
const MINT = Keypair.generate();
const RECV = Keypair.generate(); // R's token account address
const POLICY = findPolicyPda(P.publicKey, AGENT.publicKey);
const VAULT = findVaultPda(POLICY);
let connectionId: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pulso-network-requests-"));
  accounts = new Map();
  rpcDown = false;
  deps = { dir, cluster: CLUSTER, now: NOW, readAccount: async (k) => { if (rpcDown) throw new Error("rpc down"); return accounts.get(k) ?? null; } };
  accounts.set(RECV.publicKey.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, R) });
  accounts.set(POLICY.toBase58(), { owner: PROGRAM_ID.toBase58(), data: policyData() });
  accounts.set(VAULT.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, P) });
  ok(await createOrganization(deps, pub(P), { handle: "payer", displayName: "Payer", payerAgent: pub(AGENT) }));
  ok(await createOrganization(deps, pub(R), { handle: "receiver", displayName: "Receiver", receivingAccount: RECV.publicKey.toBase58() }));
  ok(await createOrganization(deps, pub(X), { handle: "third", displayName: "Third" }));
  const inv = ok(await prepareInvite(deps, HOST, pub(P), { authority: pub(R) })) as { id: string; message: string; nonce: string };
  ok(await submitInvite(deps, HOST, pub(P), { id: inv.id, target: pub(R), nonce: inv.nonce, signature: signB64(P, inv.message) }));
  const acc = ok(await prepareConnAccept(deps, HOST, pub(R), inv.id)) as { message: string; nonce: string };
  ok(await acceptConn(deps, HOST, pub(R), inv.id, { nonce: acc.nonce, signature: signB64(R, acc.message) }));
  connectionId = inv.id;
});
afterEach(() => rm(dir, { recursive: true, force: true }));

type Prepared = { snapshot: Snapshot; digest: string; message: string; nonce: string; action: string };
const input = (over: Record<string, unknown> = {}) => ({ amount: "1000000", expiry: EXP, ...over });
/** kind "charge": R issues to P. kind "send": P proposes to R. */
async function create(kind: "charge" | "send", over: Record<string, unknown> = {}, d: OrgDeps = deps) {
  const by = kind === "charge" ? R : P;
  const other = kind === "charge" ? P : R;
  const p = ok(await prepareRequest(d, HOST, pub(by), { kind, counterparty: pub(other), ...input(over) })) as Prepared;
  const res = await submitRequest(d, HOST, pub(by), { snapshot: p.snapshot, description: over.description, nonce: p.nonce, signature: signB64(by, p.message) });
  return { p, res, by, other };
}
async function accepted(): Promise<string> {
  const { res } = await create("send");
  const id = ok(res).id;
  const c = ok(await prepareAccept(deps, HOST, pub(R), id)) as { message: string; nonce: string };
  ok(await acceptRequest(deps, HOST, pub(R), id, { nonce: c.nonce, signature: signB64(R, c.message) }));
  return id;
}
const stored = () => readCollection<B2BRequest>(dir, REQUESTS);

// ---------- the pure table ----------

const snapOf = (v: any): Snapshot => ({
  kind: v.kind, genesis: v.genesis, programId: v.program_id, policy: v.policy, payerAuthority: v.payer_authority, agent: v.agent, mint: v.mint,
  recipientTokenAccount: v.recipient_token_account, receiverAuthority: v.receiver_authority, amount: v.amount, nonce: v.nonce, expiry: v.expiry,
});
const vec = (name: string) => vectors.find((v) => v.name === name);
const PAYER = vec("base_charge").payer_authority as string;
const RECEIVER = vec("base_charge").receiver_authority as string;
const OTHER = Keypair.generate().publicKey.toBase58();
const evidence = (action: ConsentEvidence["action"], authority: string, digest: string): ConsentEvidence => ({ action, terms: digest, authority, message: "m", signature: "s", at: "t" });
const SIG = "5".repeat(88);
const LATE = { reason: "after_cancel", signature: SIG, commitment: "confirmed", verified: true } as const;

function fresh(kind: "charge" | "send"): B2BRequest {
  const snapshot = snapOf(vec(kind === "charge" ? "base_charge" : "base_send"));
  const digest = digestOf(snapshot);
  const creator = kind === "charge" ? RECEIVER : PAYER;
  const out = applyTransition(null, { type: "create", base: { snapshot, digest, evidence: evidence(kind === "charge" ? "network.charge.issue" : "network.send.propose", creator, digest), description: null } }, creator, NOW);
  return rq(out);
}
const inState = (r: B2BRequest, s: Status, extra: Partial<B2BRequest> = {}): B2BRequest => ({ ...r, status: s, ...extra });
const ev = (type: string, r: B2BRequest): TransitionEvent => {
  switch (type) {
    case "accept": return { type, evidence: evidence("network.send.accept", RECEIVER, r.digest) };
    case "cancel": return { type, reason: "user" };
    case "submit": return { type, signature: SIG };
    case "verify": return { type };
    case "fail": return { type, attempt: { signature: SIG, reason: "TX_FAILED" } };
    case "late": return { type, late: LATE };
    default: return { type } as TransitionEvent;
  }
};

describe("applyTransition: the whole table of docs/B2B_NETWORK_SPEC.md section 6", () => {
  it("lines 1-3: create goes straight past criado, only the form's creator", () => {
    const c = fresh("charge");
    expect(c.status).toBe("aguardando autorização");
    expect(c.history.map((h) => [h.from, h.to, h.actor === SYSTEM ? "system" : "creator"])).toEqual([[null, "criado", "creator"], ["criado", "aguardando autorização", "system"]]);
    const s = fresh("send");
    expect(s.status).toBe("aguardando contraparte");
    expect(s.history.map((h) => h.to)).toEqual(["criado", "aguardando contraparte"]);
    const snapshot = s.snapshot;
    const good = { snapshot, digest: s.digest, evidence: evidence("network.send.propose", PAYER, s.digest), description: null };
    expect(applyTransition(null, { type: "create", base: good }, RECEIVER, NOW)).toMatchObject({ ok: false, fail: { status: 403 } }); // receiver cannot propose
    expect(applyTransition(null, { type: "create", base: { ...good, evidence: evidence("network.charge.issue", PAYER, s.digest) } }, PAYER, NOW)).toMatchObject({ ok: false, fail: { code: "BAD_CONSENT" } });
    expect(applyTransition(null, { type: "create", base: { ...good, evidence: evidence("network.send.propose", PAYER, "0".repeat(64)) } }, PAYER, NOW)).toMatchObject({ ok: false, fail: { code: "BAD_CONSENT" } });
    expect(applyTransition(null, { type: "create", base: good }, PAYER, Number(snapshot.expiry) * 1000 + 1)).toMatchObject({ ok: false, fail: { code: "INVALID_EXPIRY" } });
  });

  // [row, form, from, event, right actor, wrong actors, to]
  const rows: [number, "charge" | "send", Status, string, string, string[], Status][] = [
    [4, "send", "aguardando contraparte", "accept", RECEIVER, [PAYER, SYSTEM, OTHER], "aguardando autorização"],
    [5, "send", "aguardando contraparte", "decline", RECEIVER, [PAYER, SYSTEM], "recusado"],
    [6, "charge", "aguardando autorização", "decline", PAYER, [RECEIVER, SYSTEM], "recusado"],
    [7, "charge", "aguardando autorização", "cancel", RECEIVER, [PAYER, SYSTEM], "cancelado"],
    [7, "send", "aguardando contraparte", "cancel", PAYER, [RECEIVER, SYSTEM], "cancelado"],
    [7, "send", "aguardando autorização", "cancel", PAYER, [RECEIVER, SYSTEM], "cancelado"],
    [9, "charge", "aguardando autorização", "submit", PAYER, [SYSTEM, OTHER], "enviado"],
    [10, "charge", "enviado", "confirm", SYSTEM, [PAYER, RECEIVER], "confirmado"],
    [11, "charge", "enviado", "verify", SYSTEM, [PAYER, RECEIVER], "verificado"],
    [11, "charge", "confirmado", "verify", SYSTEM, [PAYER, RECEIVER], "verificado"],
    [12, "charge", "enviado", "fail", SYSTEM, [PAYER, RECEIVER], "aguardando autorização"],
    [12, "charge", "confirmado", "fail", SYSTEM, [PAYER, RECEIVER], "aguardando autorização"],
  ];
  it.each(rows)("line %i (%s, %s, %s)", (_n, kind, from, type, right, wrong, to) => {
    const base = kind === "send" && from === "aguardando autorização" ? inState(fresh("send"), from) : inState(fresh(kind), from);
    const e = ev(type, base);
    const out = applyTransition(base, e, right, NOW);
    expect(out).toMatchObject({ ok: true, changed: true });
    const r = rq(out);
    expect(r.status).toBe(to);
    expect(r.rev).toBe(base.rev + 1);
    expect(r.history.at(-1)).toMatchObject({ from, to, actor: right });
    for (const bad of wrong) {
      const refused = applyTransition(base, e, bad, NOW);
      expect(refused.ok).toBe(false);
      expect([403, 404]).toContain((refused as { fail: { status: number } }).fail.status);
    }
    // repeating it as the same actor is idempotent, except line 12 (its retry rule is the attempt signature, tested below)
    const again = applyTransition(r, e, right, NOW);
    expect(again).toMatchObject({ ok: true, changed: false });
    expect(ok(again).request).toBe(r);
  });

  it("line 4 also needs consent over the same digest by the receiver", () => {
    const s = fresh("send");
    expect(applyTransition(s, { type: "accept", evidence: evidence("network.send.accept", RECEIVER, "0".repeat(64)) }, RECEIVER, NOW)).toMatchObject({ ok: false, fail: { code: "BAD_CONSENT" } });
    expect(applyTransition(s, { type: "accept", evidence: evidence("network.send.propose", RECEIVER, s.digest) }, RECEIVER, NOW)).toMatchObject({ ok: false, fail: { code: "BAD_CONSENT" } });
    const r = rq(applyTransition(s, ev("accept", s), RECEIVER, NOW));
    expect(r.evidence.consent.map((c) => c.action)).toEqual(["network.send.propose", "network.send.accept"]);
  });

  it("a charge is not accepted and a proposal is not declined by the payer", () => {
    const c = fresh("charge");
    expect(applyTransition(c, ev("accept", c), RECEIVER, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
    const s = fresh("send");
    expect(applyTransition(s, { type: "decline" }, PAYER, NOW)).toMatchObject({ ok: false, fail: { status: 403 } });
    expect(applyTransition(inState(s, "aguardando autorização"), { type: "decline" }, RECEIVER, NOW)).toMatchObject({ ok: false, fail: { status: 409 } }); // line 6 is charge only
  });

  it("line 8: expiry is lazy, on read and on write, and the clock decides", () => {
    const c = fresh("charge");
    const after = Number(c.snapshot.expiry) * 1000 + 1;
    expect(applyTransition(c, { type: "expire" }, SYSTEM, NOW)).toMatchObject({ ok: false, fail: { status: 409 } }); // not expired yet
    expect(applyTransition(c, { type: "expire" }, PAYER, after)).toMatchObject({ ok: false, fail: { status: 403 } });
    const viaEvent = applyTransition(c, { type: "expire" }, SYSTEM, after);
    expect(viaEvent).toMatchObject({ ok: true, changed: true });
    expect(rq(viaEvent).status).toBe("expirado");
    // a client action on an expired request: 409, but the expiry is still reported as a change to persist
    const refused = applyTransition(c, { type: "cancel", reason: "user" }, RECEIVER, after);
    expect(refused).toMatchObject({ ok: false, changed: true, fail: { status: 409 } });
    expect((refused as { request: B2BRequest }).request.status).toBe("expirado");
    expect(applyTransition(c, ev("submit", c), PAYER, after)).toMatchObject({ ok: false, changed: true });
    expect(applyTransition(c, { type: "expire" }, SYSTEM, Number(c.snapshot.expiry) * 1000)).toMatchObject({ ok: false }); // now == expiry is not expired
    // enviado/confirmado do not expire by line 8
    expect(applyTransition(inState(c, "enviado"), ev("confirm", c), SYSTEM, after)).toMatchObject({ ok: true });
  });

  it("line 12: the destination depends on expiry; the attempt is recorded and the signature freed", () => {
    const c = inState(fresh("charge"), "enviado", { signature: SIG });
    const back = rq(applyTransition(c, ev("fail", c), SYSTEM, NOW));
    expect(back).toMatchObject({ status: "aguardando autorização", signature: null });
    expect(back.attempts).toEqual([{ signature: SIG, reason: "TX_FAILED", at: new Date(NOW).toISOString() }]);
    const late = rq(applyTransition(c, ev("fail", c), SYSTEM, Number(c.snapshot.expiry) * 1000 + 1));
    expect(late.status).toBe("expirado");
  });

  it("line 13: late payment is a mark on a terminal state that never changes the state", () => {
    for (const t of ["cancelado", "expirado", "recusado"] as Status[]) {
      const r = inState(fresh("charge"), t);
      const out = rq(applyTransition(r, { type: "late", late: LATE }, SYSTEM, NOW));
      expect(out.status).toBe(t);
      expect(out.late).toEqual(LATE);
      expect(out.history).toEqual(r.history);
      expect(applyTransition(r, { type: "late", late: LATE }, PAYER, NOW)).toMatchObject({ ok: false, fail: { status: 403 } });
      expect(applyTransition(out, { type: "late", late: { ...LATE, signature: "6".repeat(88) } }, SYSTEM, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
    }
    expect(applyTransition(inState(fresh("charge"), "verificado"), { type: "late", late: LATE }, SYSTEM, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
    expect(applyTransition(fresh("charge"), { type: "late", late: LATE }, SYSTEM, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
    // landed after the deadline: verified, with the mark
    const v = rq(applyTransition(inState(fresh("charge"), "enviado"), { type: "verify", late: { ...LATE, reason: "after_expiry_landed" } }, SYSTEM, NOW));
    expect(v).toMatchObject({ status: "verificado", late: { reason: "after_expiry_landed" } });
  });

  it("line 9 refuses a malformed signature", () => {
    const c = fresh("charge");
    expect(applyTransition(c, { type: "submit", signature: "nope" }, PAYER, NOW)).toMatchObject({ ok: false, fail: { code: "BAD_SIGNATURE" } });
    const sent = rq(applyTransition(c, ev("submit", c), RECEIVER, NOW)); // either participant
    expect(applyTransition(sent, { type: "submit", signature: "6".repeat(88) }, PAYER, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
  });

  it("terminal states do not leave, and every other combination is a 409", () => {
    const terminals: Status[] = ["verificado", "recusado", "expirado", "cancelado"];
    for (const t of terminals) {
      for (const type of ["accept", "decline", "cancel", "submit", "confirm", "fail"]) {
        for (const actor of [PAYER, RECEIVER, SYSTEM]) {
          const r = inState(fresh("send"), t);
          const out = applyTransition(r, ev(type, r), actor, NOW);
          expect(out.ok, `${t} ${type} ${actor}`).toBe(false);
          expect(out.changed).toBe(false);
        }
      }
    }
    const states: Status[] = ["aguardando contraparte", "aguardando autorização", "enviado", "confirmado"];
    for (const s of states) {
      const r = inState(fresh("send"), s);
      for (const actor of [PAYER, RECEIVER]) {
        for (const type of ["confirm", "verify", "fail", "late", "expire"]) expect(applyTransition(r, ev(type, r), actor, NOW)).toMatchObject({ ok: false, fail: { status: 403 } }); // client never reaches 8, 10-13
      }
    }
    for (const type of ["accept", "decline", "cancel", "submit"]) {
      const r = inState(fresh("send"), "enviado");
      expect(applyTransition(r, ev(type, r), RECEIVER, NOW)).toMatchObject({ ok: false, fail: { status: 409 } });
    }
  });

  it("a non-participant gets 404 and the input is never mutated", () => {
    const c = fresh("charge");
    const before = JSON.stringify(c);
    expect(applyTransition(c, { type: "decline" }, OTHER, NOW)).toMatchObject({ ok: false, fail: { status: 404 } });
    applyTransition(c, { type: "cancel", reason: "user" }, RECEIVER, NOW);
    expect(JSON.stringify(c)).toBe(before);
  });

  it("disconnect cancel is the system's, and a user cannot send that reason", () => {
    const c = fresh("charge");
    expect(applyTransition(c, { type: "cancel", reason: "disconnect" }, RECEIVER, NOW)).toMatchObject({ ok: false, fail: { status: 403 } });
    expect(rq(applyTransition(c, { type: "cancel", reason: "disconnect" }, SYSTEM, NOW)).cancellation).toEqual({ reason: "disconnect" });
    expect(applyTransition(c, { type: "cancel", reason: "user" }, SYSTEM, NOW)).toMatchObject({ ok: false, fail: { status: 403 } });
  });
});

// ---------- digest ----------

describe("digest", () => {
  it.each(vectors.map((v) => [v.name, v]))("matches shared vector %s and the SDK", (_n, v) => {
    const s = snapOf(v);
    expect(digestOf(s)).toBe(v.digest_hex);
    const sdk = computeTermsDigest({
      kind: s.kind, genesis: new PublicKey(s.genesis).toBytes(), programId: new PublicKey(s.programId), policy: new PublicKey(s.policy),
      payerAuthority: new PublicKey(s.payerAuthority), agent: new PublicKey(s.agent), mint: new PublicKey(s.mint),
      recipientTokenAccount: new PublicKey(s.recipientTokenAccount), receiverAuthority: new PublicKey(s.receiverAuthority),
      amount: BigInt(s.amount), nonce: Buffer.from(s.nonce, "hex"), expiry: BigInt(s.expiry),
    });
    expect(Buffer.from(sdk).toString("hex")).toBe(v.digest_hex);
  });

  it("the server's snapshot hashes to the SDK digest and the consent carries it", async () => {
    const { p, res } = await create("charge");
    const r = ok(res);
    expect(r.digest).toBe(p.digest);
    expect(r.digest).toBe(digestOf(p.snapshot));
    expect(p.message).toContain(`terms: ${r.digest}`);
    expect(p.message).toContain("action: network.charge.issue");
    expect(r.id).toBe(p.snapshot.nonce);
    expect(p.snapshot.nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(p.snapshot).toMatchObject({
      genesis: CLUSTER, programId: PROGRAM_ID.toBase58(), policy: POLICY.toBase58(), payerAuthority: pub(P), agent: pub(AGENT),
      mint: pub(MINT), recipientTokenAccount: pub(RECV), receiverAuthority: pub(R), amount: "1000000", expiry: EXP,
    });
  });
});

// ---------- creation end to end ----------

describe("creation and acceptance", () => {
  it("charge: R issues, ends in aguardando autorização, evidence kept, prepare persisted nothing", async () => {
    const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    expect(await stored()).toEqual([]);
    const r = ok(await submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(R, p.message) }));
    expect(r).toMatchObject({ kind: "charge", status: "aguardando autorização", direction: "sent", role: "receiver", rev: 1 });
    expect(r.evidence.consent).toHaveLength(1);
    expect(r.evidence.consent[0]).toMatchObject({ action: "network.charge.issue", authority: pub(R), terms: r.digest });
    expect(r.counterparty).toMatchObject({ handle: "payer", authority: pub(P) });
    expect(r.attempts).toEqual([]);
    expect(r.late).toBeNull();
    const asPayer = ok(await getRequest(deps, pub(P), r.id));
    expect(asPayer).toMatchObject({ direction: "received", role: "payer" });
    expect(asPayer.preimageHex).toHaveLength(614);
  });

  it("send: P proposes (waiting), R accepts over the same digest, then it is ready", async () => {
    const { p, res } = await create("send");
    const r = ok(res);
    expect(r.status).toBe("aguardando contraparte");
    expect(ok(await requestPackage(deps, pub(P), r.id))).toMatchObject({ ready: false });
    const c = ok(await prepareAccept(deps, HOST, pub(R), r.id)) as { digest: string; message: string; nonce: string; action: string };
    expect(c.digest).toBe(p.digest);
    expect(c.message).toContain(`terms: ${p.digest}`);
    expect(c.message).toContain("action: network.send.accept");
    const done = ok(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: c.nonce, signature: signB64(R, c.message) }));
    expect(done.status).toBe("aguardando autorização");
    expect(done.evidence.consent.map((e) => e.action)).toEqual(["network.send.propose", "network.send.accept"]);
    expect(ok(await requestPackage(deps, pub(P), r.id))).toMatchObject({ ready: true });
  });

  it("accept: only the receiver, only a waiting proposal, consent must be right", async () => {
    const r = ok((await create("send")).res);
    expect(await prepareAccept(deps, HOST, pub(P), r.id)).toMatchObject({ status: 403 });
    expect(await prepareAccept(deps, HOST, pub(X), r.id)).toMatchObject({ status: 404 });
    expect(await acceptRequest(deps, HOST, pub(P), r.id, { nonce: "x".repeat(43), signature: "x" })).toMatchObject({ status: 403 });
    // challenge for another digest
    const wrong = ok(await issueConsentChallenge(deps, HOST, pub(R), "network.send.accept", "0".repeat(64)));
    expect(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: wrong.nonce, signature: signB64(R, wrong.message) })).toMatchObject({ status: 401 });
    // challenge signed by the right key but for the wrong action
    const act = ok(await issueConsentChallenge(deps, HOST, pub(R), "network.charge.issue", r.digest));
    expect(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: act.nonce, signature: signB64(R, act.message) })).toMatchObject({ status: 401 });
    // challenge issued for P (wrong signer)
    const other = ok(await issueConsentChallenge(deps, HOST, pub(P), "network.send.accept", r.digest));
    expect(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: other.nonce, signature: signB64(P, other.message) })).toMatchObject({ status: 401 });
    expect((await stored())[0].status).toBe("aguardando contraparte");
    // charges are not accepted
    const charge = ok((await create("charge")).res);
    expect(await prepareAccept(deps, HOST, pub(R), charge.id)).toMatchObject({ status: 403 });
    expect(await prepareAccept(deps, HOST, pub(P), charge.id)).toMatchObject({ status: 403 });
  });

  it("accept is idempotent when two signed challenges race, and accept x cancel has one winner", async () => {
    const r = ok((await create("send")).res);
    const c1 = ok(await prepareAccept(deps, HOST, pub(R), r.id)) as { message: string; nonce: string };
    const c2 = ok(await prepareAccept(deps, HOST, pub(R), r.id)) as { message: string; nonce: string };
    const a1 = ok(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: c1.nonce, signature: signB64(R, c1.message) }));
    const a2 = ok(await acceptRequest(deps, HOST, pub(R), r.id, { nonce: c2.nonce, signature: signB64(R, c2.message) }));
    expect(a2.status).toBe(a1.status);
    expect(a2.rev).toBe(a1.rev);
    expect(a2.evidence.consent).toHaveLength(2);
    expect(await prepareAccept(deps, HOST, pub(R), r.id)).toMatchObject({ status: 409 }); // no longer waiting

    const s = ok((await create("send")).res);
    const c = ok(await prepareAccept(deps, HOST, pub(R), s.id)) as { message: string; nonce: string };
    const [x, y] = await Promise.all([
      acceptRequest(deps, HOST, pub(R), s.id, { nonce: c.nonce, signature: signB64(R, c.message) }),
      cancelRequest(deps, pub(P), s.id),
    ]);
    const http = (r: object) => ("error" in r ? (r as unknown as { status: number }).status : 200);
    expect([http(x), http(y)].sort()).toEqual([200, 409]);
    const loser = ("error" in x ? x : y) as unknown as { current: { status: string } };
    const final = (await stored()).find((q) => q.id === s.id)!;
    expect(loser.current.status).toBe(final.status);
    expect(["cancelado", "aguardando autorização"]).toContain(final.status);
  });

  it("decline and cancel: session only, by the right actor, idempotent, 409 with current state", async () => {
    const charge = ok((await create("charge")).res);
    expect(await declineRequest(deps, pub(R), charge.id)).toMatchObject({ status: 403 }); // the receiver cannot decline its own charge
    expect(await cancelRequest(deps, pub(P), charge.id)).toMatchObject({ status: 403 }); // the payer is not the creator
    expect(await cancelRequest(deps, pub(X), charge.id)).toMatchObject({ status: 404 });
    expect(ok(await declineRequest(deps, pub(P), charge.id)).status).toBe("recusado");
    const again = ok(await declineRequest(deps, pub(P), charge.id));
    expect(again.status).toBe("recusado");
    expect(again.rev).toBe(2);
    expect(await cancelRequest(deps, pub(R), charge.id)).toMatchObject({ status: 409, code: "STATE", current: { status: "recusado" } });

    const send = ok((await create("send")).res);
    expect(await declineRequest(deps, pub(P), send.id)).toMatchObject({ status: 403 });
    expect(ok(await declineRequest(deps, pub(R), send.id)).status).toBe("recusado");
    const send2 = ok((await create("send")).res);
    expect(ok(await cancelRequest(deps, pub(P), send2.id)).cancellation).toEqual({ reason: "user" });
    expect(ok(await cancelRequest(deps, pub(P), send2.id)).rev).toBe(2);
  });

  it("edit = cancel with reason edited and supersededBy a new request of mine", async () => {
    const old = ok((await create("charge")).res);
    expect(await cancelRequest(deps, pub(R), old.id, { reason: "edited", supersededBy: "a".repeat(32) })).toMatchObject({ status: 400 }); // unknown id
    expect(await cancelRequest(deps, pub(R), old.id, { reason: "other", supersededBy: "a".repeat(32) })).toMatchObject({ status: 400 });
    const fresh2 = ok((await create("charge", { amount: "2000000" })).res);
    expect(fresh2.id).not.toBe(old.id);
    expect(fresh2.digest).not.toBe(old.digest);
    const c = ok(await cancelRequest(deps, pub(R), old.id, { reason: "edited", supersededBy: fresh2.id }));
    expect(c).toMatchObject({ status: "cancelado", cancellation: { reason: "edited", supersededBy: fresh2.id } });
  });

  it("lazy expiry on read and on write; restart keeps everything", async () => {
    const r = ok((await create("charge")).res);
    const later: OrgDeps = { ...deps, now: Number(EXP) * 1000 + 1 };
    expect(ok(await listRequests(later, pub(P)))[0].status).toBe("expirado"); // read does not persist
    expect((await stored())[0].status).toBe("aguardando autorização");
    expect(ok(await getRequest(later, pub(P), r.id)).status).toBe("expirado");
    expect(ok(await requestPackage(later, pub(P), r.id))).toMatchObject({ status: "expirado", ready: false });
    expect(await cancelRequest(later, pub(R), r.id)).toMatchObject({ status: 409, current: { status: "expirado" } });
    expect((await stored())[0]).toMatchObject({ status: "expirado", rev: 2 }); // write persisted it
    expect((await stored())[0].history.at(-1)).toMatchObject({ to: "expirado", actor: SYSTEM });
    const reopened: OrgDeps = { ...deps, readAccount: async () => null };
    expect(ok(await getRequest(reopened, pub(R), r.id))).toMatchObject({ id: r.id, status: "expirado", digest: r.digest });
  });
});

// ---------- creation refusals ----------

describe("creation refusals", () => {
  const refuses = async (kind: "charge" | "send", over: Record<string, unknown>, st: number, cd?: string) => {
    const by = kind === "charge" ? R : P;
    const other = kind === "charge" ? P : R;
    const out = await prepareRequest(deps, HOST, pub(by), { kind, counterparty: pub(other), ...input(over) });
    expect(status(out)).toBe(st);
    if (cd) expect(code(out)).toBe(cd);
    expect(await stored()).toEqual([]);
  };

  it("no active connection, including after disconnect, and none with oneself", async () => {
    expect(await prepareRequest(deps, HOST, pub(X), { kind: "send", counterparty: pub(R), ...input() })).toMatchObject({ status: 409, code: "NO_ACTIVE_CONNECTION" });
    expect(await prepareRequest(deps, HOST, pub(P), { kind: "send", counterparty: pub(P), ...input() })).toMatchObject({ status: 400, code: "SELF_REQUEST" });
    ok(await disconnect(deps, pub(P), connectionId));
    await refuses("send", {}, 409, "NO_ACTIVE_CONNECTION");
  });

  it("payer agent, receiving account, policy, vault and mint preconditions", async () => {
    ok(await updateOrganization(deps, pub(P), { payerAgent: null }));
    await refuses("charge", {}, 400, "NO_PAYER_AGENT");
    ok(await updateOrganization(deps, pub(P), { payerAgent: pub(AGENT) }));
    ok(await updateOrganization(deps, pub(R), { receivingAccount: null }));
    await refuses("charge", {}, 400, "NO_RECEIVING_ACCOUNT");
    ok(await updateOrganization(deps, pub(R), { receivingAccount: pub(RECV) }));

    accounts.delete(POLICY.toBase58());
    await refuses("charge", {}, 400, "POLICY_NOT_FOUND");
    accounts.set(POLICY.toBase58(), { owner: TOKEN_PROGRAM_ID, data: policyData() }); // wrong owner
    await refuses("charge", {}, 400, "BAD_POLICY");
    accounts.set(POLICY.toBase58(), { owner: PROGRAM_ID.toBase58(), data: new Uint8Array(48) }); // wrong discriminator
    await refuses("charge", {}, 400, "BAD_POLICY");
    accounts.set(POLICY.toBase58(), { owner: PROGRAM_ID.toBase58(), data: policyData() });

    accounts.delete(VAULT.toBase58());
    await refuses("charge", {}, 400, "VAULT_NOT_FOUND");
    accounts.set(VAULT.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(Keypair.generate(), P) });
    await refuses("charge", {}, 400, "MINT_MISMATCH");
    accounts.set(VAULT.toBase58(), { owner: PROGRAM_ID.toBase58(), data: tokenAccount(MINT, P) });
    await refuses("charge", {}, 400, "BAD_VAULT");
    accounts.set(VAULT.toBase58(), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, P) });

    accounts.set(pub(RECV), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, X) }); // owner changed after the org saved it
    await refuses("charge", {}, 400, "BAD_RECEIVING_ACCOUNT");
    accounts.delete(pub(RECV));
    await refuses("send", {}, 400, "BAD_RECEIVING_ACCOUNT");
    accounts.set(pub(RECV), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(MINT, R) });
    ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })); // all restored
  });

  it("RPC unavailable refuses with 503", async () => {
    rpcDown = true;
    await refuses("charge", {}, 503, "RPC_ERROR");
  });

  it.each([["0"], ["-1"], ["1.5"], [1000], [1e6], ["01"], [" 1"], ["1e3"], ["18446744073709551616"], [null], ["0x10"]])("amount %j is refused", async (amount) => {
    await refuses("charge", { amount }, 400, "INVALID_AMOUNT");
  });
  it("amount 2^64-1 is accepted", async () => {
    const { res } = await create("charge", { amount: "18446744073709551615" });
    expect(ok(res).snapshot.amount).toBe("18446744073709551615");
  });

  it("expiry in the past, now, over 30 days, malformed", async () => {
    for (const expiry of [String(NOW / 1000 - 1), String(NOW / 1000), String(NOW / 1000 + 30 * 86_400 + 1), "abc", "1.5", -5, null]) await refuses("charge", { expiry }, 400, "INVALID_EXPIRY");
    ok((await create("charge", { expiry: String(NOW / 1000 + 30 * 86_400) })).res); // exactly 30 days
  });

  it("description: optional, at most 280, no control characters, never in the digest", async () => {
    await refuses("charge", { description: "x".repeat(281) }, 400, "INVALID_DESCRIPTION");
    await refuses("charge", { description: "a‮b" }, 400, "INVALID_DESCRIPTION");
    await refuses("charge", { description: 5 }, 400, "INVALID_DESCRIPTION");
    const a = ok((await create("charge", { description: "x".repeat(280) })).res);
    expect(a.description).toHaveLength(280);
    const none = ok((await create("charge")).res);
    expect(none.description).toBeNull();
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: none.snapshot, description: "y".repeat(281), nonce: "x".repeat(43), signature: "x" })).toMatchObject({ code: "INVALID_DESCRIPTION" });
  });

  it("the form's creator only; the kind is validated", async () => {
    expect(await prepareRequest(deps, HOST, pub(R), { kind: "nope", counterparty: pub(P), ...input() })).toMatchObject({ code: "INVALID_KIND" });
    const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    // P replays R's snapshot: not the creator of a charge
    expect(await submitRequest(deps, HOST, pub(P), { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(P, p.message) })).toMatchObject({ status: 403 });
  });
});

// ---------- submit integrity ----------

describe("submit integrity", () => {
  it.each(["kind", "genesis", "programId", "policy", "payerAuthority", "agent", "mint", "recipientTokenAccount", "receiverAuthority", "amount", "nonce", "expiry"] as const)(
    "a tampered %s is refused and nothing is stored",
    async (field) => {
      const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
      const tweaked: Record<string, string> = { ...p.snapshot };
      const v = tweaked[field];
      tweaked[field] = field === "kind" ? "send" : field === "amount" ? "1000001" : field === "expiry" ? String(Number(v) + 1) : field === "nonce" ? "f".repeat(32) : Keypair.generate().publicKey.toBase58();
      const out = await submitRequest(deps, HOST, pub(R), { snapshot: tweaked, nonce: p.nonce, signature: signB64(R, p.message) });
      expect("error" in out).toBe(true);
      expect(await stored()).toEqual([]);
    },
  );

  it("extra or missing snapshot keys are refused", async () => {
    const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    const sig = signB64(R, p.message);
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: { ...p.snapshot, status: "verificado" }, nonce: p.nonce, signature: sig })).toMatchObject({ code: "MALFORMED" });
    const { mint: _m, ...missing } = p.snapshot;
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: missing, nonce: p.nonce, signature: sig })).toMatchObject({ code: "MALFORMED" });
    expect(await submitRequest(deps, HOST, pub(R), { nonce: p.nonce, signature: sig })).toMatchObject({ code: "MALFORMED" });
    expect(await stored()).toEqual([]);
  });

  it("consent with the wrong action, signer or terms is refused; replay is refused", async () => {
    const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    const bad = async (kp: Keypair, action: "network.send.propose" | "network.charge.issue", terms: string) => {
      const c = ok(await issueConsentChallenge(deps, HOST, pub(kp), action, terms));
      return submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, nonce: c.nonce, signature: signB64(kp, c.message) });
    };
    expect(await bad(R, "network.send.propose", p.digest)).toMatchObject({ status: 401 });
    expect(await bad(P, "network.charge.issue", p.digest)).toMatchObject({ status: 401 });
    expect(await bad(R, "network.charge.issue", "0".repeat(64))).toMatchObject({ status: 401 });
    // signed by another key under R's challenge
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(P, p.message) })).toMatchObject({ status: 401 });
    // a bad attempt burned that challenge: the right signature no longer works
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(R, p.message) })).toMatchObject({ status: 401 });
    expect(await stored()).toEqual([]);

    const fresh2 = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    const body = { snapshot: fresh2.snapshot, nonce: fresh2.nonce, signature: signB64(R, fresh2.message) };
    ok(await submitRequest(deps, HOST, pub(R), body));
    expect(await submitRequest(deps, HOST, pub(R), body)).toMatchObject({ status: 401 }); // replay
    expect(await stored()).toHaveLength(1);
  });

  it("a request id (nonce) is unique inside the lock", async () => {
    const a = ok((await create("charge")).res);
    // same snapshot prepared again by hand with the stored nonce: the digest is the same, the id is taken
    const c = ok(await issueConsentChallenge(deps, HOST, pub(R), "network.charge.issue", a.digest));
    expect(await submitRequest(deps, HOST, pub(R), { snapshot: a.snapshot, nonce: c.nonce, signature: signB64(R, c.message) })).toMatchObject({ status: 409, code: "ID_TAKEN" });
    expect(await stored()).toHaveLength(1);
  });

  it("the stored digest is rechecked on critical reads", async () => {
    const r = ok((await create("charge")).res);
    await mutateCollection<B2BRequest, void>(dir, REQUESTS, (items) => { items[0].snapshot.amount = "1"; });
    expect(await getRequest(deps, pub(R), r.id)).toMatchObject({ status: 500, code: "DIGEST_MISMATCH" });
    expect(await requestPackage(deps, pub(R), r.id)).toMatchObject({ status: 500 });
  });
});

// ---------- isolation, package, system, disconnect ----------

describe("reads", () => {
  it("lists only the caller's requests with sent/received views; third parties get 404 on everything", async () => {
    const c = ok((await create("charge")).res);
    const s = ok((await create("send")).res);
    expect(ok(await listRequests(deps, pub(R))).map((r) => r.id).sort()).toEqual([c.id, s.id].sort());
    expect(ok(await listRequests(deps, pub(R), "sent")).map((r) => r.id)).toEqual([c.id]);
    expect(ok(await listRequests(deps, pub(R), "received")).map((r) => r.id)).toEqual([s.id]);
    expect(ok(await listRequests(deps, pub(P), "sent")).map((r) => r.id)).toEqual([s.id]);
    expect(await listRequests(deps, pub(P), "all")).toMatchObject({ status: 400 });
    expect(ok(await listRequests(deps, pub(X)))).toEqual([]);
    for (const id of [c.id, s.id]) {
      expect(await getRequest(deps, pub(X), id)).toMatchObject({ status: 404 });
      expect(await requestPackage(deps, pub(X), id)).toMatchObject({ status: 404 });
      expect(await prepareAccept(deps, HOST, pub(X), id)).toMatchObject({ status: 404 });
      expect(await acceptRequest(deps, HOST, pub(X), id, { nonce: "x".repeat(43), signature: "x" })).toMatchObject({ status: 404 });
      expect(await declineRequest(deps, pub(X), id)).toMatchObject({ status: 404 });
      expect(await cancelRequest(deps, pub(X), id)).toMatchObject({ status: 404 });
    }
    expect(await getRequest(deps, pub(P), "0".repeat(32))).toMatchObject({ status: 404 }); // unknown looks the same
  });

  it("the agent package has no private description and carries verifiable evidence", async () => {
    const id = await accepted();
    const withNote = ok((await create("charge", { description: "SECRET-NOTE" })).res);
    expect(ok(await getRequest(deps, pub(P), withNote.id)).description).toBe("SECRET-NOTE"); // both participants see it
    const pkg = ok(await requestPackage(deps, pub(P), withNote.id));
    expect(JSON.stringify(pkg)).not.toContain("SECRET-NOTE");
    expect(Object.keys(pkg).sort()).toEqual(["consent", "digest", "kind", "ready", "requestId", "snapshot", "status", "version"]);
    expect(pkg).toMatchObject({ version: "pulso-b2b-package-v1", requestId: withNote.id, kind: "charge", status: "aguardando autorização", ready: true });
    expect(digestOf(pkg.snapshot)).toBe(pkg.digest);
    expect(pkg.consent).toHaveLength(1);
    const c = pkg.consent[0];
    expect(Object.keys(c).sort()).toEqual(["action", "at", "message", "signature", "signer"]);
    expect(c).toMatchObject({ action: "network.charge.issue", signer: pub(R) });
    expect(c.message.split("\n")).toContain(`terms: ${pkg.digest}`);
    const key = createPublicKey({ key: Buffer.concat([SPKI, R.publicKey.toBytes()]), format: "der", type: "spki" });
    expect(verify(null, Buffer.from(c.message), key, Buffer.from(c.signature, "base64"))).toBe(true);
    expect(verify(null, Buffer.from(c.message + "x"), key, Buffer.from(c.signature, "base64"))).toBe(false);
    // proposal with both consents
    const sendPkg = ok(await requestPackage(deps, pub(R), id));
    expect(sendPkg.consent.map((e) => e.action)).toEqual(["network.send.propose", "network.send.accept"]);
    expect(sendPkg.consent.map((e) => e.signer)).toEqual([pub(P), pub(R)]);
    for (const e of sendPkg.consent) {
      const k = createPublicKey({ key: Buffer.concat([SPKI, new PublicKey(e.signer).toBytes()]), format: "der", type: "spki" });
      expect(verify(null, Buffer.from(e.message), k, Buffer.from(e.signature, "base64"))).toBe(true);
    }
  });
});

describe("system entry and disconnect", () => {
  it("systemTransition reaches lines 10-13 with a rev compare-and-set", async () => {
    const r = ok((await create("charge")).res);
    await mutateCollection<B2BRequest, void>(dir, REQUESTS, (items) => { items[0].status = "enviado"; items[0].signature = SIG; });
    const stale = (await stored())[0].rev;
    expect(ok(await systemTransition(deps, r.id, { type: "confirm" }, stale)).status).toBe("confirmado");
    expect(await systemTransition(deps, r.id, { type: "verify" }, stale)).toMatchObject({ status: 409, code: "CONFLICT" });
    expect(ok(await systemTransition(deps, r.id, { type: "verify" })).status).toBe("verificado");
    expect(ok(await systemTransition(deps, r.id, { type: "verify" })).status).toBe("verificado"); // idempotent
    expect(await systemTransition(deps, "0".repeat(32), { type: "confirm" })).toMatchObject({ status: 404 });
  });

  it("the client cannot reach 10-13: there is no route entry and a body status is ignored", async () => {
    const p = ok(await prepareRequest(deps, HOST, pub(R), { kind: "charge", counterparty: pub(P), ...input() })) as Prepared;
    const out = ok(await submitRequest(deps, HOST, pub(R), { snapshot: p.snapshot, nonce: p.nonce, signature: signB64(R, p.message), status: "verificado" } as never));
    expect(out.status).toBe("aguardando autorização");
    expect(ok(await cancelRequest(deps, pub(R), out.id, { status: "verificado" } as never)).status).toBe("cancelado"); // the field is not a thing
    expect((await stored())[0].status).toBe("cancelado");
  });

  it("disconnect cancels the pair's pending requests and keeps the ones already sent", async () => {
    const charge = ok((await create("charge")).res);
    const send = ok((await create("send")).res);
    const sent = ok((await create("charge", { amount: "5" })).res);
    await mutateCollection<B2BRequest, void>(dir, REQUESTS, (items) => { items.find((q) => q.id === sent.id)!.status = "enviado"; });
    ok(await disconnect(deps, pub(P), connectionId));
    const byId = Object.fromEntries((await stored()).map((q) => [q.id, q]));
    for (const id of [charge.id, send.id]) {
      expect(byId[id]).toMatchObject({ status: "cancelado", cancellation: { reason: "disconnect" } });
      expect(byId[id].history.at(-1)).toMatchObject({ to: "cancelado", actor: SYSTEM });
    }
    expect(byId[sent.id].status).toBe("enviado");
    const rev = byId[charge.id].rev;
    ok(await disconnect(deps, pub(R), connectionId)); // repeating changes nothing
    expect((await stored()).find((q) => q.id === charge.id)!.rev).toBe(rev);
  });
});
