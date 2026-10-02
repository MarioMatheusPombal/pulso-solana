import { beforeEach, describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { findPolicyPda } from "@pulso/sdk";
import { activities } from "../lib/store";
import * as route from "../app/api/activity/route";

const key = () => Keypair.generate().publicKey;
const actor = key();
const authority = key();
const agent = key();
const programId = key();
const policy = findPolicyPda(authority, agent, programId).toBase58();
const request = (method: string, body?: unknown, url = "http://x/api/activity") =>
  new Request(url, body === undefined ? { method } : { method, body: JSON.stringify(body), headers: { "content-type": "application/json" } });

function event(eventId: string, status: string = "blocked") {
  return {
    eventId, status, evidence: status === "blocked" ? "simulation" : "confirmed_transaction",
    authority: authority.toBase58(), agent: agent.toBase58(), programId: programId.toBase58(), policy,
    mint: actor.toBase58(), actionHash: "ab".repeat(32), amount: "1000000", recipient: actor.toBase58(),
    ...(status === "blocked" ? { code: "PULSO_003_HUMAN_INTENT_REQUIRED" } : { signature: "1".repeat(88) }),
  };
}

beforeEach(() => activities.clear());

describe("activity API", () => {
  it("stores structured reports and lists them chronologically by policy", async () => {
    const older = event("00000000-0000-4000-8000-000000000001");
    const newer = event("00000000-0000-4000-8000-000000000002", "executed");
    expect((await route.POST(request("POST", older))).status).toBe(201);
    activities.get(older.eventId)!.createdAt = "2026-10-01T00:00:00.000Z";
    expect((await route.POST(request("POST", newer))).status).toBe(201);
    activities.get(newer.eventId)!.createdAt = "2026-10-01T00:00:01.000Z";

    const rows = await (await route.GET(request("GET", undefined, `http://x/api/activity?policy=${policy}`))).json();
    expect(rows.map((row: { status: string }) => row.status)).toEqual(["blocked", "executed"]);
    expect((await route.GET(request("GET"))).status).toBe(400);
  });

  it.each([
    ["arbitrary text", { message: "<script>alert(1)</script>" }],
    ["unknown code", { code: "PULSO_999_FAKE" }],
    ["mismatched PDA", { policy: key().toBase58() }],
    ["unbounded amount", { amount: "9".repeat(100) }],
    ["oversized body", { message: "x".repeat(5000) }],
  ])("rejects %s", async (label, patch) => {
    const res = await route.POST(request("POST", { ...event("00000000-0000-4000-8000-000000000003"), ...patch }));
    expect(res.status).toBe(label === "oversized body" ? 413 : 400);
  });

  it("accepts a confirmed rejection only with code and signature, and keeps simulation rejections signature-free", async () => {
    const base = { ...event("00000000-0000-4000-8000-000000000005", "rejected"), code: "PULSO_006_INTENT_MISMATCH" };
    expect((await route.POST(request("POST", base))).status).toBe(201);
    const noSig = { ...base, eventId: "00000000-0000-4000-8000-000000000006", signature: undefined };
    expect((await route.POST(request("POST", noSig))).status).toBe(400);
    const noCode = { ...base, eventId: "00000000-0000-4000-8000-000000000007", code: undefined };
    expect((await route.POST(request("POST", noCode))).status).toBe(400);
    const simWithSig = { ...base, eventId: "00000000-0000-4000-8000-000000000008", evidence: "simulation" };
    expect((await route.POST(request("POST", simWithSig))).status).toBe(400);
    const approval = { ...base, eventId: "00000000-0000-4000-8000-000000000009", code: "PULSO_003_HUMAN_INTENT_REQUIRED" };
    expect((await route.POST(request("POST", approval))).status).toBe(400);
  });

  it("is idempotent by eventId and rejects unfiltered or invalid policy queries", async () => {
    const b = event("00000000-0000-4000-8000-000000000004");
    await route.POST(request("POST", b));
    expect((await route.POST(request("POST", b))).status).toBe(200);
    expect((await route.GET(request("GET", undefined, "http://x/api/activity?policy=bad"))).status).toBe(400);
    expect(activities.size).toBe(1);
  });

  it("keeps only the newest 1000 reports", async () => {
    for (let i = 0; i < 1001; i++) {
      const id = `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`;
      const res = await route.POST(request("POST", event(id)));
      expect(res.status).toBeGreaterThanOrEqual(200);
      expect(res.status).toBeLessThan(300);
    }
    expect(activities.size).toBe(1000);
    expect(activities.has("00000000-0000-4000-8000-000000000000")).toBe(false);
    expect(activities.has("00000000-0000-4000-8000-0000000003e8")).toBe(true);
  });
});
