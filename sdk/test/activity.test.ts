import { describe, expect, it } from "vitest";
import { Connection, Keypair } from "@solana/web3.js";
import { PulsoClient } from "../src/client.js";

const payload = () => ({
  status: "rejected",
  evidence: "simulation",
  amount: 10n,
  recipient: Keypair.generate().publicKey,
  actionHash: "ab".repeat(32),
  code: "PULSO_006_INTENT_MISMATCH",
});
const reporter = (client: PulsoClient) => Reflect.get(client, "postActivity").bind(client) as (event: ReturnType<typeof payload>) => Promise<void>;

describe("optional activity reporting", () => {
  it("makes no request unless activityUrl is configured", async () => {
    let calls = 0;
    const client = new PulsoClient({
      connection: new Connection("http://127.0.0.1:8899"),
      agent: Keypair.generate(),
      human: Keypair.generate().publicKey,
      fetch: (async () => { calls++; return new Response("ok"); }) as typeof fetch,
    });
    await reporter(client)(payload());
    expect(calls).toBe(0);
  });

  it("sends bounded public fields and returns when the sink hangs", async () => {
    let body: Record<string, unknown> | undefined;
    const client = new PulsoClient({
      connection: new Connection("http://127.0.0.1:8899"),
      agent: Keypair.generate(),
      human: Keypair.generate().publicKey,
      activityUrl: "http://app.test/",
      fetch: (async (url: string, init: RequestInit) => {
        expect(url).toBe("http://app.test/api/activity");
        body = JSON.parse(String(init.body));
        return new Promise<Response>(() => {});
      }) as typeof fetch,
    });
    const start = Date.now();
    await reporter(client)(payload());
    expect(Date.now() - start).toBeLessThan(2000);
    expect(body).toMatchObject({ status: "rejected", evidence: "simulation", code: "PULSO_006_INTENT_MISMATCH" });
    expect(body).toMatchObject({ authority: client.human.toBase58(), agent: client.agent.publicKey.toBase58(), policy: client.policy.toBase58() });
    expect(body).not.toHaveProperty("logs");
    expect(body).not.toHaveProperty("privateKey");
    expect(body).not.toHaveProperty("prompt");
  });
});
