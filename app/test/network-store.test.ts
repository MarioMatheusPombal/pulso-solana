import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivateKey, sign } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { issueChallenge, issueConsentChallenge, verifyChallenge, verifyConsent, type ConsentAction } from "../lib/network-auth";
import { mutateCollection, readCollection } from "../lib/network-store";
import {
  TOKEN_PROGRAM_ID, allowSearch, createOrganization, findOrganization, getOwnOrganization, normalizeHandle, updateOrganization,
  validateReceivingAccount, type AccountData, type OrgDeps, type Organization,
} from "../lib/network-store-orgs";
import {
  CONNECTION_TTL_MS, accept, cancel, decline, disconnect, listConnections, prepareAccept, prepareInvite, submitInvite, type ConnectionOut,
} from "../lib/network-store-connections";

const HOST = "pulso.test";
const CLUSTER = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const signB64 = (kp: Keypair, message: string) =>
  sign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, kp.secretKey.slice(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");

/** 165-byte SPL token account: mint 0..32, owner 32..64, state byte 108. */
function tokenAccount(mint: Keypair, owner: Keypair, state = 1, size = 165): Uint8Array {
  const data = new Uint8Array(size);
  data.set(mint.publicKey.toBytes(), 0);
  data.set(owner.publicKey.toBytes(), 32);
  data[108] = state;
  return data;
}

let dir: string;
let accounts: Map<string, AccountData>;
let rpcDown: boolean;
let deps: OrgDeps;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pulso-network-store-"));
  accounts = new Map();
  rpcDown = false;
  deps = {
    dir, cluster: CLUSTER, now: 1_800_000_000_000,
    readAccount: async (k) => { if (rpcDown) throw new Error("rpc down"); return accounts.get(k) ?? null; },
  };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const ok = <T,>(r: T): Exclude<T, { error: string }> => {
  if (r && typeof r === "object" && "error" in r) throw new Error(`unexpected failure: ${JSON.stringify(r)}`);
  return r as Exclude<T, { error: string }>;
};
const status = (r: unknown) => (r as { status: number }).status;
const pub = (kp: Keypair) => kp.publicKey.toBase58();

async function org(kp: Keypair, handle: string) {
  return ok(await createOrganization(deps, pub(kp), { handle, displayName: handle.toUpperCase() })) as Organization;
}
async function consent(kp: Keypair, action: ConsentAction, terms: string) {
  const c = ok(await issueConsentChallenge(deps, HOST, pub(kp), action, terms));
  return { nonce: c.nonce, signature: signB64(kp, c.message), message: c.message };
}
async function invite(from: Keypair, to: Keypair): Promise<ConnectionOut> {
  const p = ok(await prepareInvite(deps, HOST, pub(from), { authority: pub(to) })) as { id: string; message: string; nonce: string };
  return ok(await submitInvite(deps, HOST, pub(from), { id: p.id, target: pub(to), nonce: p.nonce, signature: signB64(from, p.message) }));
}
async function acceptInvite(by: Keypair, id: string) {
  const p = ok(await prepareAccept(deps, HOST, pub(by), id)) as { message: string; nonce: string };
  return accept(deps, HOST, pub(by), id, { nonce: p.nonce, signature: signB64(by, p.message) });
}
const A = Keypair.generate();
const B = Keypair.generate();
const C = Keypair.generate();

describe("consent (network-auth extension)", () => {
  it("builds the exact consent envelope and returns the evidence", async () => {
    const terms = "pulso-connection-v1:x:y:z";
    const c = ok(await issueConsentChallenge(deps, HOST, pub(A), "network.connect.invite", terms));
    const lines = c.message.split("\n");
    expect(lines).toHaveLength(10);
    expect(lines.slice(0, 8)).toEqual([
      "PULSO network consent", "NOT A TRANSACTION · grants no spending authority", `domain: ${HOST}`, "action: network.connect.invite",
      `authority: ${pub(A)}`, `cluster: ${CLUSTER}`, `terms: ${terms}`, `nonce: ${c.nonce}`,
    ]);
    const sig = signB64(A, c.message);
    const ev = ok(await verifyConsent(deps, HOST, c.nonce, sig, { action: "network.connect.invite", terms, authority: pub(A) }));
    expect(ev).toEqual({ action: "network.connect.invite", terms, authority: pub(A), message: c.message, signature: sig, at: new Date(deps.now).toISOString() });
  });

  it("refuses unknown actions, bad terms, replay, wrong action/terms/authority", async () => {
    expect(await issueConsentChallenge(deps, HOST, pub(A), "network.login", "t")).toHaveProperty("error");
    expect(await issueConsentChallenge(deps, HOST, pub(A), "network.connect.invite", "two words")).toHaveProperty("error");
    expect(await issueConsentChallenge(deps, HOST, "bad", "network.connect.invite", "t")).toHaveProperty("error");
    const exp = { action: "network.connect.invite", terms: "t1", authority: pub(A) } as { action: ConsentAction; terms: string; authority: string };
    const cases: Array<Partial<typeof exp>> = [{ action: "network.connect.accept" }, { terms: "t2" }, { authority: pub(B) }];
    for (const wrong of cases) {
      const c = await consent(A, "network.connect.invite", "t1");
      expect(status(await verifyConsent(deps, HOST, c.nonce, c.signature, Object.assign({}, exp, wrong)))).toBe(401);
      // a refused attempt still burned the nonce
      expect(status(await verifyConsent(deps, HOST, c.nonce, c.signature, exp))).toBe(401);
    }
    const c = await consent(A, "network.connect.invite", "t1");
    ok(await verifyConsent(deps, HOST, c.nonce, c.signature, exp));
    expect(status(await verifyConsent(deps, HOST, c.nonce, c.signature, exp))).toBe(401);
  });

  it("refuses wrong signer, wrong domain, expiry", async () => {
    const exp = { action: "network.connect.invite", terms: "t1", authority: pub(A) } as { action: ConsentAction; terms: string; authority: string };
    const c1 = await consent(A, "network.connect.invite", "t1");
    expect(status(await verifyConsent(deps, HOST, c1.nonce, signB64(B, c1.message), exp))).toBe(401);
    const c2 = await consent(A, "network.connect.invite", "t1");
    expect(status(await verifyConsent(deps, "evil.test", c2.nonce, c2.signature, exp))).toBe(401);
    const c3 = await consent(A, "network.connect.invite", "t1");
    expect(status(await verifyConsent({ ...deps, now: deps.now + 6 * 60_000 }, HOST, c3.nonce, c3.signature, exp))).toBe(401);
  });

  it("a login challenge never serves as consent, and a consent never logs in", async () => {
    const login = ok(await issueChallenge(deps, HOST, pub(A)));
    const exp = { action: "network.connect.invite", terms: "t1", authority: pub(A) } as { action: ConsentAction; terms: string; authority: string };
    expect(status(await verifyConsent(deps, HOST, login.nonce, signB64(A, login.message), exp))).toBe(401);
    const c = await consent(A, "network.connect.invite", "t1");
    expect(status(await verifyChallenge(deps, HOST, c.nonce, c.signature))).toBe(401);
  });
});

describe("store adapter", () => {
  it("persists across reopen and refuses unknown versions", async () => {
    await mutateCollection<{ n: number }, void>(dir, "things", (items) => { items.push({ n: 1 }); });
    expect(await readCollection(dir, "things")).toEqual([{ n: 1 }]);
    expect(JSON.parse(await readFile(join(dir, "things.json"), "utf8")).version).toBe(1);
    await expect(readCollection(dir, "nothing")).resolves.toEqual([]);
    await writeFile(join(dir, "old.json"), JSON.stringify({ version: 2, items: [] }));
    await expect(readCollection(dir, "old")).rejects.toThrow(/unsupported/);
  });

  it("serializes concurrent mutations", async () => {
    await Promise.all(Array.from({ length: 20 }, (_, i) => mutateCollection<number, void>(dir, "n", (items) => { items.push(i); })));
    expect((await readCollection<number>(dir, "n")).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i));
  });
});

describe("handle and display name", () => {
  it("normalizes per spec section 3", () => {
    expect(normalizeHandle("  @Acme_1 ")).toBe("acme_1");
    expect(normalizeHandle("acme")).toBe("acme");
    for (const bad of ["аcme", "ab", "a".repeat(33), "@@acme", "ac me", "acme!", "", 5, null, "ａｃｍｅ"]) expect(normalizeHandle(bad)).toBeNull();
  });

  it("creates, rejects duplicates by case, reserved, bad names, second org per authority", async () => {
    const o = await org(A, "Acme");
    expect(o.handle).toBe("acme");
    expect(o.authority).toBe(pub(A));
    expect(await createOrganization(deps, pub(B), { handle: "ACME", displayName: "x" })).toMatchObject({ status: 409, code: "HANDLE_TAKEN" });
    expect(await createOrganization(deps, pub(A), { handle: "other", displayName: "x" })).toMatchObject({ status: 409, code: "AUTHORITY_TAKEN" });
    for (const h of ["admin", "@Pulso", "support", "official", "system"]) {
      expect(await createOrganization(deps, pub(B), { handle: h, displayName: "x" })).toMatchObject({ status: 400, code: "RESERVED_HANDLE" });
    }
    expect(await createOrganization(deps, pub(B), { handle: "аcme", displayName: "x" })).toMatchObject({ code: "INVALID_HANDLE" });
    for (const name of ["", "   ", "a".repeat(65), "bad\nname", "rtl‮evil", "iso⁦x"]) {
      expect(await createOrganization(deps, pub(B), { handle: "okname", displayName: name })).toMatchObject({ code: "INVALID_NAME" });
    }
    expect(await readCollection(dir, "organizations")).toHaveLength(1);
  });

  it("two lookalike handles with distinct wallets both exist and resolve to the right key", async () => {
    await org(A, "acme");
    await org(B, "acrne");
    expect(await findOrganization(deps, { handle: "acme" })).toEqual({ handle: "acme", displayName: "ACME", authority: pub(A) });
    expect(await findOrganization(deps, { handle: "@acrne" })).toMatchObject({ authority: pub(B) });
  });

  it("uses the session authority, not the body", async () => {
    const o = ok(await createOrganization(deps, pub(A), { handle: "acme", displayName: "x", authority: pub(B) } as never)) as Organization;
    expect(o.authority).toBe(pub(A));
  });
});

describe("search", () => {
  it("exact match only, minimal result, distinct errors", async () => {
    const o = await org(A, "acme");
    await updateOrganization(deps, pub(A), { payerAgent: pub(C) });
    for (const found of [await findOrganization(deps, { handle: "ACME" }), await findOrganization(deps, { authority: pub(A) })]) {
      expect(Object.keys(found).sort()).toEqual(["authority", "displayName", "handle"]);
      expect(found).toMatchObject({ authority: pub(A) });
    }
    expect(JSON.stringify(await findOrganization(deps, { handle: "acme" }))).not.toContain(pub(C));
    expect(await findOrganization(deps, { handle: "acm" })).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await findOrganization(deps, { handle: "acm_nothere" })).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await findOrganization(deps, { authority: pub(B) })).toMatchObject({ status: 404, code: "NOT_FOUND" });
    expect(await findOrganization(deps, { authority: "not-a-key" })).toMatchObject({ status: 400, code: "INVALID_PUBKEY" });
    expect(await findOrganization(deps, {})).toMatchObject({ status: 400 });
    expect(await findOrganization(deps, { handle: "acme", authority: pub(A) })).toMatchObject({ status: 400 });
    expect(o.id).toHaveLength(32);
  });

  it("rate limits per authority", () => {
    const k = pub(Keypair.generate());
    for (let i = 0; i < 30; i += 1) expect(allowSearch(k, 1000)).toBe(true);
    expect(allowSearch(k, 1001)).toBe(false);
    expect(allowSearch(k, 1000 + 61_000)).toBe(true);
  });
});

describe("receiving account validation", () => {
  const mint = Keypair.generate();
  const acct = Keypair.generate();
  const put = (data: Uint8Array, owner = TOKEN_PROGRAM_ID) => accounts.set(pub(acct), { owner, data });

  it("accepts a valid account and records mint, owner and time", async () => {
    put(tokenAccount(mint, A));
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toEqual({
      tokenAccount: pub(acct), mint: pub(mint), owner: pub(A), checkedAt: new Date(deps.now).toISOString(),
    });
  });

  it("refuses wrong owner field, program, size, state, missing account, bad key and RPC failure", async () => {
    put(tokenAccount(mint, B));
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    put(tokenAccount(mint, A), Keypair.generate().publicKey.toBase58());
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    put(tokenAccount(mint, A, 1, 82));
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    put(tokenAccount(mint, A, 0));
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    put(tokenAccount(mint, A, 2));
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    accounts.clear();
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    expect(await validateReceivingAccount(deps, "nope", pub(A))).toMatchObject({ code: "INVALID_PUBKEY" });
    put(tokenAccount(mint, A));
    rpcDown = true;
    expect(await validateReceivingAccount(deps, pub(acct), pub(A))).toMatchObject({ status: 503, code: "RPC_ERROR" });
  });

  it("create and update validate on chain; update keeps history and never touches handle/authority", async () => {
    put(tokenAccount(mint, A));
    expect(await createOrganization(deps, pub(B), { handle: "bee", displayName: "b", receivingAccount: pub(acct) })).toMatchObject({ code: "BAD_RECEIVING_ACCOUNT" });
    const o = ok(await createOrganization(deps, pub(A), { handle: "acme", displayName: "Acme", receivingAccount: pub(acct) })) as Organization;
    expect(o.receivingAccount?.tokenAccount).toBe(pub(acct));
    const second = Keypair.generate();
    accounts.set(pub(second), { owner: TOKEN_PROGRAM_ID, data: tokenAccount(mint, A) });
    const u = ok(await updateOrganization(deps, pub(A), { receivingAccount: pub(second), payerAgent: pub(C), handle: "hacked", authority: pub(B) } as never)) as Organization;
    expect(u.receivingAccount?.tokenAccount).toBe(pub(second));
    expect(u.receivingAccountHistory.map((r) => r.tokenAccount)).toEqual([pub(acct)]);
    expect(u).toMatchObject({ handle: "acme", authority: pub(A), payerAgent: pub(C), rev: 2 });
    rpcDown = true;
    expect(await updateOrganization(deps, pub(A), { receivingAccount: pub(acct) })).toMatchObject({ status: 503 });
    expect(await updateOrganization(deps, pub(A), { payerAgent: "bad" })).toMatchObject({ code: "INVALID_PUBKEY" });
    expect(await updateOrganization(deps, pub(A), { payerAgent: pub(A) })).toMatchObject({ code: "AGENT_IS_AUTHORITY" });
    expect(await updateOrganization(deps, pub(B), { payerAgent: pub(C) })).toMatchObject({ status: 404 });
    expect(await getOwnOrganization(deps, pub(A))).toMatchObject({ rev: 2 });
  });
});

describe("connections", () => {
  beforeEach(async () => {
    await org(A, "acme");
    await org(B, "beta");
    await org(C, "gamma");
  });

  it("invite then accept stores evidence and an informational snapshot; both sides see it", async () => {
    const inv = await invite(A, B);
    expect(inv).toMatchObject({ status: "pendente", view: "enviado", direction: "sent", counterparty: { authority: pub(B), handle: "beta" } });
    expect(inv.evidence.invite).toMatchObject({ action: "network.connect.invite", authority: pub(A) });
    expect(inv.evidence.invite.terms).toBe(`pulso-connection-v1:${pub(A)}:${pub(B)}:${inv.id}`);
    expect((await listConnections(deps, pub(B)))[0]).toMatchObject({ view: "recebido", direction: "received" });
    await updateOrganization(deps, pub(B), { payerAgent: pub(C) });
    const acc = ok(await acceptInvite(B, inv.id)) as ConnectionOut;
    expect(acc).toMatchObject({ status: "ativa", view: "aceito" });
    expect(acc.evidence.accept).toMatchObject({ action: "network.connect.accept", terms: inv.evidence.invite.terms, authority: pub(B) });
    expect(acc.snapshot).toEqual({ a: { receivingAccount: null, payerAgent: null }, b: { receivingAccount: null, payerAgent: pub(C) } });
    expect((await listConnections(deps, pub(A)))[0]).toMatchObject({ view: "aceito" });
  });

  it("survives a restart (fresh deps, same directory)", async () => {
    const inv = await invite(A, B);
    const reopened: OrgDeps = { ...deps, now: deps.now + 1000 };
    expect(await listConnections(reopened, pub(B))).toHaveLength(1);
    expect(ok(await acceptInvite(B, inv.id))).toMatchObject({ status: "ativa" });
    expect((await listConnections(reopened, pub(A)))[0]).toMatchObject({ status: "ativa" });
  });

  it("rejects self, unknown target, caller without organization, invalid key", async () => {
    expect(await prepareInvite(deps, HOST, pub(A), { authority: pub(A) })).toMatchObject({ status: 400, code: "SELF_CONNECTION" });
    expect(await prepareInvite(deps, HOST, pub(A), { handle: "nobody" })).toMatchObject({ status: 404 });
    expect(await prepareInvite(deps, HOST, pub(A), { authority: "bad" })).toMatchObject({ code: "INVALID_PUBKEY" });
    expect(await prepareInvite(deps, HOST, pub(Keypair.generate()), { handle: "acme" })).toMatchObject({ status: 403 });
    const p = ok(await prepareInvite(deps, HOST, pub(A), { handle: "@BETA" })) as { target: { authority: string } };
    expect(p.target.authority).toBe(pub(B));
    const self = ok(await issueConsentChallenge(deps, HOST, pub(A), "network.connect.invite", "pulso-connection-v1:x"));
    expect(await submitInvite(deps, HOST, pub(A), { id: "0".repeat(32), target: pub(A), nonce: self.nonce, signature: signB64(A, self.message) })).toMatchObject({ code: "SELF_CONNECTION" });
  });

  it("refuses a tampered, replayed, wrong-signer or expired invite", async () => {
    const p = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    const sig = signB64(A, p.message);
    // tampered target: terms no longer match the stored challenge (and the nonce is burned)
    expect(await submitInvite(deps, HOST, pub(A), { id: p.id, target: pub(C), nonce: p.nonce, signature: sig })).toMatchObject({ status: 401 });
    expect(await submitInvite(deps, HOST, pub(A), { id: p.id, target: pub(B), nonce: p.nonce, signature: sig })).toMatchObject({ status: 401 });
    // someone else's signature
    const p2 = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    expect(await submitInvite(deps, HOST, pub(A), { id: p2.id, target: pub(B), nonce: p2.nonce, signature: signB64(C, p2.message) })).toMatchObject({ status: 401 });
    // another session replaying A's challenge
    const p3 = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    expect(await submitInvite(deps, HOST, pub(C), { id: p3.id, target: pub(B), nonce: p3.nonce, signature: signB64(A, p3.message) })).toMatchObject({ status: 401 });
    // expired challenge
    const p4 = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    expect(await submitInvite({ ...deps, now: deps.now + 6 * 60_000 }, HOST, pub(A), { id: p4.id, target: pub(B), nonce: p4.nonce, signature: signB64(A, p4.message) })).toMatchObject({ status: 401 });
    expect(await listConnections(deps, pub(A))).toHaveLength(0);
  });

  it("a reused invite signature cannot create a second connection", async () => {
    const p = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    const body = { id: p.id, target: pub(B), nonce: p.nonce, signature: signB64(A, p.message) };
    ok(await submitInvite(deps, HOST, pub(A), body));
    expect(await submitInvite(deps, HOST, pub(A), body)).toMatchObject({ status: 401 });
    expect(await listConnections(deps, pub(A))).toHaveLength(1);
  });

  it("an invite consent cannot serve as accept (wrong action)", async () => {
    const inv = await invite(A, B);
    const c = await consent(B, "network.connect.invite", inv.evidence.invite.terms);
    expect(await accept(deps, HOST, pub(B), inv.id, { nonce: c.nonce, signature: c.signature })).toMatchObject({ status: 401 });
    expect((await listConnections(deps, pub(B)))[0].status).toBe("pendente");
  });

  it("third parties and the inviter cannot accept; third parties get 404 everywhere", async () => {
    const inv = await invite(A, B);
    expect(await prepareAccept(deps, HOST, pub(C), inv.id)).toMatchObject({ status: 404 });
    expect(await prepareAccept(deps, HOST, pub(A), inv.id)).toMatchObject({ status: 403 });
    const c = await consent(C, "network.connect.accept", inv.evidence.invite.terms);
    expect(await accept(deps, HOST, pub(C), inv.id, { nonce: c.nonce, signature: c.signature })).toMatchObject({ status: 404 });
    for (const fn of [decline, cancel, disconnect]) expect(await fn(deps, pub(C), inv.id)).toMatchObject({ status: 404 });
    expect(await decline(deps, pub(A), inv.id)).toMatchObject({ status: 403 });
    expect(await cancel(deps, pub(B), inv.id)).toMatchObject({ status: 403 });
    expect(await listConnections(deps, pub(C))).toEqual([]);
    expect((await listConnections(deps, pub(B)))[0].status).toBe("pendente");
  });

  it("duplicate and crossed invites get 409 pointing at the existing one", async () => {
    const inv = await invite(A, B);
    expect(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })).toMatchObject({ status: 409, code: "DUPLICATE", current: { id: inv.id } });
    expect(await prepareInvite(deps, HOST, pub(B), { authority: pub(A) })).toMatchObject({ status: 409, code: "CROSSED", current: { id: inv.id } });
    // race past prepare: both prepared before either committed
    ok(await decline(deps, pub(B), inv.id));
    const pa = ok(await prepareInvite(deps, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    const pb = ok(await prepareInvite(deps, HOST, pub(B), { authority: pub(A) })) as { id: string; message: string; nonce: string };
    const results = await Promise.all([
      submitInvite(deps, HOST, pub(A), { id: pa.id, target: pub(B), nonce: pa.nonce, signature: signB64(A, pa.message) }),
      submitInvite(deps, HOST, pub(B), { id: pb.id, target: pub(A), nonce: pb.nonce, signature: signB64(B, pb.message) }),
    ]);
    expect(results.filter((r) => "error" in r).map(status)).toEqual([409]);
    expect((await readCollection(dir, "connections")).filter((c) => (c as { status: string }).status === "pendente")).toHaveLength(1);
  });

  it("accept x decline race: exactly one wins, the other gets 409 with the state", async () => {
    const inv = await invite(A, B);
    const p = ok(await prepareAccept(deps, HOST, pub(B), inv.id)) as { message: string; nonce: string };
    const [acc, dec] = await Promise.all([
      accept(deps, HOST, pub(B), inv.id, { nonce: p.nonce, signature: signB64(B, p.message) }),
      decline(deps, pub(B), inv.id),
    ]);
    const results = [acc, dec];
    expect(results.filter((r) => !("error" in r))).toHaveLength(1);
    const loser = results.find((r) => "error" in r)!;
    expect(loser).toMatchObject({ status: 409, code: "STATE" });
    const [final] = await listConnections(deps, pub(A));
    expect((loser as unknown as { current: ConnectionOut }).current.status).toBe(final.status);
  });

  it("is idempotent for repeated actions and refuses impossible transitions", async () => {
    const inv = await invite(A, B);
    ok(await decline(deps, pub(B), inv.id));
    expect(ok(await decline(deps, pub(B), inv.id))).toMatchObject({ status: "recusada" });
    expect(await prepareAccept(deps, HOST, pub(B), inv.id)).toMatchObject({ status: 409 });
    expect(await cancel(deps, pub(A), inv.id)).toMatchObject({ status: 409 });
    expect(await disconnect(deps, pub(A), inv.id)).toMatchObject({ status: 409 });

    const inv2 = await invite(A, B); // re-invite after decline: new id
    expect(inv2.id).not.toBe(inv.id);
    ok(await acceptInvite(B, inv2.id));
    expect(await prepareAccept(deps, HOST, pub(B), inv2.id)).toMatchObject({ status: 409 }); // prepare reports state
    const c = await consent(B, "network.connect.accept", inv2.evidence.invite.terms);
    const again = ok(await accept(deps, HOST, pub(B), inv2.id, { nonce: c.nonce, signature: c.signature })) as ConnectionOut; // signed retry: idempotent
    expect(again).toMatchObject({ status: "ativa", rev: 2 });
    expect(await decline(deps, pub(B), inv2.id)).toMatchObject({ status: 409 });
    expect(ok(await disconnect(deps, pub(B), inv2.id))).toMatchObject({ status: "desconectada", view: "desconectado" });
    expect(ok(await disconnect(deps, pub(A), inv2.id))).toMatchObject({ status: "desconectada" });
  });

  it("cancel hides the invite from the invitee but not the inviter", async () => {
    const inv = await invite(A, B);
    ok(await cancel(deps, pub(A), inv.id));
    expect(await listConnections(deps, pub(B))).toEqual([]);
    expect((await listConnections(deps, pub(A)))[0]).toMatchObject({ status: "cancelada", view: "cancelado" });
  });

  it("expires lazily after 7 days: read shows expired, write refuses and persists it", async () => {
    const inv = await invite(A, B);
    const late = { ...deps, now: deps.now + CONNECTION_TTL_MS };
    expect((await listConnections(late, pub(B)))[0]).toMatchObject({ status: "expirada", view: "expirado" });
    expect((await readCollection<{ status: string }>(dir, "connections"))[0].status).toBe("pendente");
    expect(await prepareAccept(late, HOST, pub(B), inv.id)).toMatchObject({ status: 409 });
    expect(await decline(late, pub(B), inv.id)).toMatchObject({ status: 409 });
    expect((await readCollection<{ status: string }>(dir, "connections"))[0].status).toBe("expirada");
    // an expired invite does not block a new one
    const p = ok(await prepareInvite(late, HOST, pub(A), { authority: pub(B) })) as { id: string; message: string; nonce: string };
    expect(ok(await submitInvite(late, HOST, pub(A), { id: p.id, target: pub(B), nonce: p.nonce, signature: signB64(A, p.message) }))).toMatchObject({ status: "pendente" });
  });

  it("isolates organizations: lists only own connections", async () => {
    await invite(A, B);
    await invite(C, B);
    expect(await listConnections(deps, pub(B))).toHaveLength(2);
    expect(await listConnections(deps, pub(A))).toHaveLength(1);
    expect(await listConnections(deps, pub(C))).toHaveLength(1);
    expect((await listConnections(deps, pub(A)))[0].counterparty).toEqual({ handle: "beta", displayName: "BETA", authority: pub(B) });
  });
});
