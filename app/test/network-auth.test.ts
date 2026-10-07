import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPrivateKey, sign } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import {
  CHALLENGE_TTL_MS, SESSION_COOKIE, SESSION_TTL_MS, destroySession, getSession, issueChallenge, loginMessage,
  requireSameOrigin, requireSession, sessionCookie, verifyChallenge, type AuthDeps,
} from "../lib/network-auth";

const HOST = "pulso.test";
const CLUSTER = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG";
const PKCS8 = Buffer.from("302e020100300506032b657004220420", "hex");
const signB64 = (kp: Keypair, message: string) =>
  sign(null, Buffer.from(message), createPrivateKey({ key: Buffer.concat([PKCS8, kp.secretKey.slice(0, 32)]), format: "der", type: "pkcs8" })).toString("base64");

let dir: string;
let deps: AuthDeps;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "pulso-network-"));
  deps = { dir, cluster: CLUSTER, now: 1_800_000_000_000 };
});
afterEach(() => rm(dir, { recursive: true, force: true }));

async function challenge(kp: Keypair, domain = HOST) {
  const c = await issueChallenge(deps, domain, kp.publicKey.toBase58());
  if ("error" in c) throw new Error(c.error);
  return c;
}
async function login(kp: Keypair) {
  const c = await challenge(kp);
  const r = await verifyChallenge(deps, HOST, c.nonce, signB64(kp, c.message));
  if ("error" in r) throw new Error(r.error);
  return r;
}
const reqWith = (headers: Record<string, string>) => new Request(`https://${HOST}/api/x`, { method: "POST", headers: { host: HOST, ...headers } });

describe("network auth challenge", () => {
  it("builds the exact message", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    expect(c.message).toBe(loginMessage({
      domain: HOST, authority: kp.publicKey.toBase58(), cluster: CLUSTER, nonce: c.nonce,
      issued: deps.now, expires: deps.now + CHALLENGE_TTL_MS,
    }));
    const lines = c.message.split("\n");
    expect(lines).toHaveLength(9);
    expect(lines[0]).toBe("PULSO network sign-in");
    expect(lines[2]).toBe(`domain: ${HOST}`);
    expect(lines[3]).toBe("action: network.login");
    expect(Buffer.from(c.nonce, "base64url")).toHaveLength(32);
    expect(c.expiresAt).toBe(new Date(deps.now + CHALLENGE_TTL_MS).toISOString());
  });

  it("rejects malformed authority", async () => {
    // "0" is outside the base58 alphabet; a random key plus a valid base58 char can still decode to 32 bytes.
    for (const bad of ["", "abc", 42, null, "0".repeat(44), `${Keypair.generate().publicKey.toBase58().slice(0, 43)}0`]) {
      expect(await issueChallenge(deps, HOST, bad)).toHaveProperty("error");
    }
  });
});

describe("network auth verify", () => {
  it("signs in and opens a session for the signer", async () => {
    const kp = Keypair.generate();
    const r = await login(kp);
    expect(r.session).toEqual({ authority: kp.publicKey.toBase58(), cluster: CLUSTER, expiresAt: new Date(deps.now + SESSION_TTL_MS).toISOString() });
    expect(await getSession(deps, r.token)).toEqual(r.session);
  });

  it("rejects replay of a consumed nonce", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    const sig = signB64(kp, c.message);
    expect("token" in (await verifyChallenge(deps, HOST, c.nonce, sig))).toBe(true);
    expect(await verifyChallenge(deps, HOST, c.nonce, sig)).toMatchObject({ status: 401 });
  });

  it("lets only one of two concurrent verifications win", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    const sig = signB64(kp, c.message);
    const results = await Promise.all(Array.from({ length: 5 }, () => verifyChallenge(deps, HOST, c.nonce, sig)));
    expect(results.filter((r) => "token" in r)).toHaveLength(1);
  });

  it("consumes the nonce even when the first attempt is invalid", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    expect(await verifyChallenge(deps, HOST, c.nonce, signB64(Keypair.generate(), c.message))).toMatchObject({ status: 401 });
    expect(await verifyChallenge(deps, HOST, c.nonce, signB64(kp, c.message))).toMatchObject({ status: 401 });
  });

  it("rejects an expired challenge", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    const late = { ...deps, now: deps.now + CHALLENGE_TTL_MS };
    expect(await verifyChallenge(late, HOST, c.nonce, signB64(kp, c.message))).toMatchObject({ status: 401 });
  });

  it("rejects a signature from another wallet", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    expect(await verifyChallenge(deps, HOST, c.nonce, signB64(Keypair.generate(), c.message))).toMatchObject({ status: 401 });
  });

  it("rejects a signature over a tampered message", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    expect(await verifyChallenge(deps, HOST, c.nonce, signB64(kp, c.message.replace("network.login", "network.admin")))).toMatchObject({ status: 401 });
  });

  it("rejects a wrong domain", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp, "evil.test");
    expect(await verifyChallenge(deps, HOST, c.nonce, signB64(kp, c.message))).toMatchObject({ status: 401 });
  });

  it("rejects a wrong cluster", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    const other = { ...deps, cluster: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" };
    expect(await verifyChallenge(other, HOST, c.nonce, signB64(kp, c.message))).toMatchObject({ status: 401 });
  });

  it("rejects malformed input with 400", async () => {
    const kp = Keypair.generate();
    const c = await challenge(kp);
    const sig = signB64(kp, c.message);
    expect(await verifyChallenge(deps, HOST, "nope", sig)).toMatchObject({ status: 400 });
    expect(await verifyChallenge(deps, HOST, 7, sig)).toMatchObject({ status: 400 });
    expect(await verifyChallenge(deps, HOST, c.nonce, Buffer.alloc(63).toString("base64"))).toMatchObject({ status: 400 });
    expect(await verifyChallenge(deps, HOST, c.nonce, undefined)).toMatchObject({ status: 400 });
    // unknown but well-formed nonce
    expect(await verifyChallenge(deps, HOST, Buffer.alloc(32, 1).toString("base64url"), sig)).toMatchObject({ status: 401 });
    // malformed attempts did not burn the real nonce
    expect("token" in (await verifyChallenge(deps, HOST, c.nonce, sig))).toBe(true);
  });
});

describe("network session", () => {
  it("expires", async () => {
    const r = await login(Keypair.generate());
    expect(await getSession({ ...deps, now: deps.now + SESSION_TTL_MS - 1 }, r.token)).not.toBeNull();
    expect(await getSession({ ...deps, now: deps.now + SESSION_TTL_MS }, r.token)).toBeNull();
  });

  it("is invalid under a different cluster", async () => {
    const r = await login(Keypair.generate());
    const other = { ...deps, cluster: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d" };
    expect(await getSession(other, r.token)).toBeNull();
    await expect(requireSession(reqWith({ cookie: `${SESSION_COOKIE}=${r.token}` }), other)).rejects.toMatchObject({ status: 401 });
  });

  it("logout invalidates it", async () => {
    const r = await login(Keypair.generate());
    await destroySession(deps, r.token);
    expect(await getSession(deps, r.token)).toBeNull();
  });

  it("another authority's session is not the first one's", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const ra = await login(a);
    const rb = await login(b);
    expect(ra.token).not.toBe(rb.token);
    expect((await getSession(deps, ra.token))?.authority).toBe(a.publicKey.toBase58());
    expect((await getSession(deps, rb.token))?.authority).toBe(b.publicKey.toBase58());
    await destroySession(deps, rb.token);
    expect(await getSession(deps, ra.token)).not.toBeNull();
  });

  it("survives a restart and never stores the raw token", async () => {
    const r = await login(Keypair.generate());
    const reopened: AuthDeps = { ...deps }; // new "process": same directory, nothing in memory
    expect(await getSession(reopened, r.token)).toEqual(r.session);
    const raw = await (await import("node:fs/promises")).readFile(join(dir, "auth.json"), "utf8");
    expect(raw).not.toContain(r.token);
  });

  it("garbage and missing tokens give no session", async () => {
    expect(await getSession(deps, null)).toBeNull();
    expect(await getSession(deps, "garbage")).toBeNull();
  });
});

describe("request helpers", () => {
  it("requireSession returns the authority from the cookie only", async () => {
    const kp = Keypair.generate();
    const r = await login(kp);
    const ok = reqWith({ cookie: `a=1; ${SESSION_COOKIE}=${r.token}` });
    expect(await requireSession(ok, deps)).toBe(kp.publicKey.toBase58());
    // authority in a header/body-ish place does not authenticate
    const forged = reqWith({ "x-authority": kp.publicKey.toBase58() });
    await expect(requireSession(forged, deps)).rejects.toMatchObject({ status: 401 });
    await expect(requireSession(reqWith({ cookie: `${SESSION_COOKIE}=bad` }), deps)).rejects.toMatchObject({ status: 401 });
  });

  it("requireSameOrigin: missing or different Origin is 403", () => {
    expect(() => requireSameOrigin(reqWith({ origin: `https://${HOST}` }))).not.toThrow();
    for (const headers of [{} as Record<string, string>,{ origin: "https://evil.test" }, { origin: "not a url" }, { origin: "null" }]) {
      try {
        requireSameOrigin(reqWith(headers));
        throw new Error("should have thrown");
      } catch (e) {
        expect((e as Response).status).toBe(403);
      }
    }
  });

  it("cookie flags", () => {
    const prev = process.env.NODE_ENV;
    try {
      vi_env("development");
      expect(sessionCookie("t")).toBe(`${SESSION_COOKIE}=t; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`);
      vi_env("production");
      expect(sessionCookie("t")).toContain("; Secure");
    } finally {
      vi_env(prev);
    }
  });
});

function vi_env(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value;
}
