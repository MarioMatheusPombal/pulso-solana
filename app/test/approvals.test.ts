import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { buildIntent } from "@pulso/sdk";
import { approvals } from "../lib/store";
import * as collection from "../app/api/approvals/route";
import * as item from "../app/api/approvals/[id]/route";

const pk = () => Keypair.generate().publicKey;
const hex = (b: Uint8Array) => Buffer.from(b).toString("hex");

function body(authority = pk(), amount = 1000n) {
  const i = buildIntent({
    programId: pk(), authority, agent: pk(), mint: pk(), amount, recipient: pk(), expiresAt: 2000000000n,
  });
  const f = i.fields;
  return {
    programId: f.programId.toBase58(), policy: pk().toBase58(), authority: f.authority.toBase58(),
    agent: f.agent.toBase58(), mint: f.mint.toBase58(), recipient: f.recipient.toBase58(),
    amount: f.amount.toString(), expiresAt: f.expiresAt.toString(), maxUses: f.maxUses,
    nonce: hex(i.nonce), actionHash: hex(i.actionHash),
  };
}
const json = (method: string, b: unknown) =>
  new Request("http://x/api/approvals", { method, body: JSON.stringify(b), headers: { "content-type": "application/json" } });
const post = (b: unknown) => collection.POST(json("POST", b));
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const patch = (id: string, b: unknown) => item.PATCH(json("PATCH", b), ctx(id));
const list = (qs = "") => collection.GET(new Request(`http://x/api/approvals${qs}`));

beforeEach(() => approvals.clear());

describe("approvals API", () => {
  it("creates a pending request with id = actionHash", async () => {
    const b = body();
    const res = await post(b);
    expect(res.status).toBe(201);
    const r = await res.json();
    expect(r).toMatchObject({ ...b, id: b.actionHash, status: "pending" });
    expect(typeof r.createdAt).toBe("string");
  });

  it("is idempotent", async () => {
    const b = body();
    await post(b);
    const res = await post(b);
    expect(res.status).toBe(200);
    expect(approvals.size).toBe(1);
  });

  it("rejects a tampered hash (amount changed)", async () => {
    const res = await post({ ...body(), amount: "999999" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/does not match/);
  });

  it.each([
    ["bad pubkey", { recipient: "nope" }],
    ["bad nonce", { nonce: "abcd" }],
    ["bad amount", { amount: "-1" }],
    ["bad maxUses", { maxUses: 1.5 }],
    ["bad hash format", { actionHash: "zz" }],
  ])("rejects invalid field: %s", async (_n, patchFields) => {
    const res = await post({ ...body(), ...patchFields });
    expect(res.status).toBe(400);
    expect(typeof (await res.json()).error).toBe("string");
  });

  it("rejects non-object body", async () => {
    expect((await post("x")).status).toBe(400);
  });

  it("lists newest first with filters", async () => {
    const auth = pk();
    const a = body(auth, 1n), b = body(auth, 2n), c = body(pk(), 3n);
    for (const x of [a, b, c]) await post(x);
    await patch(a.actionHash, { status: "denied" });

    const all = await (await list()).json();
    expect(all.map((r: { id: string }) => r.id)).toEqual([c.actionHash, b.actionHash, a.actionHash]);
    const byAuth = await (await list(`?authority=${auth.toBase58()}`)).json();
    expect(byAuth).toHaveLength(2);
    const pending = await (await list(`?authority=${auth.toBase58()}&status=pending`)).json();
    expect(pending.map((r: { id: string }) => r.id)).toEqual([b.actionHash]);
    expect((await list("?status=bogus")).status).toBe(400);
  });

  it("gets one request and 404s on unknown id", async () => {
    const b = body();
    await post(b);
    const res = await item.GET(new Request("http://x"), ctx(b.actionHash));
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe(b.actionHash);
    expect((await item.GET(new Request("http://x"), ctx("00".repeat(32)))).status).toBe(404);
  });

  it("approves and stores the signature", async () => {
    const b = body();
    await post(b);
    const res = await patch(b.actionHash, { status: "approved", signature: "5abc" });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "approved", signature: "5abc" });
  });

  it("denies", async () => {
    const b = body();
    await post(b);
    expect((await (await patch(b.actionHash, { status: "denied" })).json()).status).toBe("denied");
  });

  it("returns 409 on transition from a non-pending state", async () => {
    const b = body();
    await post(b);
    await patch(b.actionHash, { status: "approved" });
    expect((await patch(b.actionHash, { status: "denied" })).status).toBe(409);
    expect((await patch(b.actionHash, { status: "approved" })).status).toBe(409);
  });

  it("rejects invalid PATCH body and unknown id", async () => {
    const b = body();
    await post(b);
    expect((await patch(b.actionHash, { status: "pending" })).status).toBe(400);
    expect((await patch("00".repeat(32), { status: "approved" })).status).toBe(404);
  });
});
