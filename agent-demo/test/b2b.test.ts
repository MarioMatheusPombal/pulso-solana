import { PROGRAM_ID, type PendingApproval } from "@pulso/sdk";
import { Keypair, PublicKey } from "@solana/web3.js";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { B2BRefusal, executePackage, type ClientLike, type ConnectionLike, type SentState } from "../src/b2b.js";
import { GENESIS, buildPackage, newParties } from "./b2b-fixtures.js";

// Doubles for PulsoClient and the connection: no validator here. The real flow is in b2b.e2e.test.ts.
const parties = newParties();
const pkg = buildPackage(parties);
const ID = pkg.requestId;
type Status = { err: unknown; confirmationStatus?: string } | null;

let dir: string;
beforeEach(() => void (dir = mkdtempSync(join(tmpdir(), "pulso-b2b-"))));
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const conn = (status: Status = null, blockhashValid = false): ConnectionLike & { statuses: ReturnType<typeof vi.fn> } => {
  const statuses = vi.fn(async () => ({ value: [status] }));
  return { statuses, getGenesisHash: async () => GENESIS, getSignatureStatuses: statuses, isBlockhashValid: async () => ({ value: blockhashValid }) };
};
const state = (extra: Partial<SentState> = {}): SentState => ({ requestId: ID, mode: "autonomous", blockhash: "bh", signature: "sigOLD", at: "now", ...extra });
const seed = (s: SentState) => writeFileSync(join(dir, `${ID}.json`), JSON.stringify(s));
const run = (c: ConnectionLike, client: ClientLike, extra: object = {}, p: unknown = pkg) =>
  executePackage({ pkg: p, agent: parties.agent.publicKey, connection: c, makeClient: () => client, stateDir: dir, now: () => 1_800_000_000, ...extra });

/** Client that "sends" like the SDK would: reports the blockhash, then the signature, through the connection. */
const sender = (c: ConnectionLike, signature: string) => async () => {
  c.onSend?.("bhNEW");
  c.onSent?.(signature);
  return { status: "executed" as const, signature };
};
const client = (o: Partial<Record<keyof ClientLike, unknown>> = {}) =>
  ({ execute: vi.fn(), waitForApproval: vi.fn(async () => {}), executeApproved: vi.fn(), ...o }) as unknown as ClientLike & Record<keyof ClientLike, ReturnType<typeof vi.fn>>;

describe("b2b adapter (issue 309)", () => {
  it("executes the exact snapshot values, with its 16-byte nonce, and reports signature and mode", async () => {
    const c = conn();
    const cl = client();
    cl.execute.mockImplementation(sender(c, "sigA"));
    const out = await run(c, cl);
    expect(out).toMatchObject({ status: "executed", mode: "autonomous", signature: "sigA", alreadySent: false });
    const arg = cl.execute.mock.calls[0]![0];
    expect(arg.amount).toBe(5_000_000n);
    expect(arg.recipient.toBase58()).toBe(pkg.snapshot.recipientTokenAccount);
    expect(Buffer.from(arg.nonce).toString("hex")).toBe(pkg.snapshot.nonce);
    expect(JSON.parse(readFileSync(join(dir, `${ID}.json`), "utf8"))).toMatchObject({ requestId: ID, mode: "autonomous", signature: "sigA", blockhash: "bhNEW" });
  });

  it("executes nothing when validation fails, and does not even build a client", async () => {
    const makeClient = vi.fn();
    const bad = { ...buildPackage(parties), digest: "00".repeat(32), ready: true };
    await expect(executePackage({ pkg: bad, agent: parties.agent.publicKey, connection: conn(), makeClient, stateDir: dir })).rejects.toMatchObject({ code: "DIGEST_MISMATCH" });
    expect(makeClient).not.toHaveBeenCalled();
  });

  it("does not resend a signature that is already confirmed", async () => {
    seed(state({ mode: "approved" }));
    const cl = client();
    const out = await run(conn({ err: null, confirmationStatus: "finalized" }), cl);
    expect(out).toMatchObject({ status: "executed", mode: "approved", signature: "sigOLD", alreadySent: true });
    expect(cl.execute).not.toHaveBeenCalled();
  });

  it("does not resend while the previous transaction may still land", async () => {
    seed(state());
    const cl = client();
    await expect(run(conn(null, true), cl)).rejects.toMatchObject({ code: "SEND_PENDING" });
    await expect(run(conn({ err: null, confirmationStatus: "processed" }, false), cl)).rejects.toBeInstanceOf(B2BRefusal);
    seed(state({ signature: undefined })); // crashed between onSend and onSent, blockhash still valid
    await expect(run(conn(null, true), cl)).rejects.toMatchObject({ code: "SEND_PENDING" });
    expect(cl.execute).not.toHaveBeenCalled();
  });

  it("resends when the previous blockhash expired without confirming, or it failed on-chain", async () => {
    for (const c of [conn(null, false), conn({ err: { InstructionError: [0, { Custom: 6008 }] } }, true)]) {
      seed(state());
      const cl = client();
      cl.execute.mockImplementation(sender(c, "sigNEW"));
      const out = await run(c, cl);
      expect(out).toMatchObject({ signature: "sigNEW", alreadySent: false });
      expect(cl.execute).toHaveBeenCalledTimes(1);
    }
  });

  it("survives a timeout and a restart: the second process reads the state file", async () => {
    const first = conn();
    const cl1 = client();
    cl1.execute.mockImplementation(async () => {
      first.onSend?.("bh1");
      first.onSent?.("sigT");
      throw new Error("confirmation timeout");
    });
    await expect(run(first, cl1)).rejects.toThrow("confirmation timeout");

    const cl2 = client();
    await expect(run(conn(null, true), cl2)).rejects.toMatchObject({ code: "SEND_PENDING" }); // may still land
    const out = await run(conn({ err: null, confirmationStatus: "confirmed" }), cl2); // it landed
    expect(out).toMatchObject({ signature: "sigT", alreadySent: true });
    expect(cl2.execute).not.toHaveBeenCalled();
  });

  describe("policy asks for the human", () => {
    const intent = (over: object = {}) =>
      ({
        status: "HUMAN_INTENT_REQUIRED", reason: "HUMAN_INTENT_REQUIRED", approvalId: "ab".repeat(32), approvalUrl: undefined,
        intent: {
          fields: {
            programId: PROGRAM_ID, authority: parties.payer.publicKey, agent: parties.agent.publicKey, mint: parties.mint,
            recipient: parties.recipientTokenAccount, amount: 5_000_000n, nonce: Buffer.from(ID, "hex"), ...over,
          },
        },
      }) as unknown as PendingApproval;

    it("waits for the intent, revalidates, then executes the approved action", async () => {
      const c = conn();
      const cl = client();
      cl.execute.mockResolvedValue(intent());
      cl.executeApproved.mockImplementation(sender(c, "sigB"));
      const order: string[] = [];
      cl.waitForApproval.mockImplementation(async () => void order.push("wait"));
      const out = await run(c, cl, { onPause: async () => void order.push("pause") });
      expect(out).toMatchObject({ status: "executed", mode: "approved", signature: "sigB" });
      expect(order).toEqual(["pause", "wait"]);
      expect(JSON.parse(readFileSync(join(dir, `${ID}.json`), "utf8")).mode).toBe("approved");
    });

    it("never records the human's record_intent sent through the same connection while paused", async () => {
      const c = conn({ err: null, confirmationStatus: "finalized" }); // every signature looks confirmed
      const cl = client();
      cl.execute.mockResolvedValue(intent());
      const recordIntent = async () => {
        c.onSend?.("bhRI");
        c.onSent?.("sigRI");
      };
      // crash right after the approval, before executeApproved
      cl.waitForApproval.mockRejectedValue(new Error("crash"));
      await expect(run(c, cl, { onPause: recordIntent })).rejects.toThrow("crash");
      expect(() => readFileSync(join(dir, `${ID}.json`))).toThrow(); // nothing recorded

      // rerun: must pay (once), never report the record_intent signature as the payment
      const cl2 = client();
      cl2.execute.mockImplementation(sender(c, "sigPAY"));
      const out = await run(c, cl2);
      expect(out).toMatchObject({ signature: "sigPAY", alreadySent: false });
      expect(cl2.execute).toHaveBeenCalledTimes(1);

      // approved flow end to end: only the payment lands in the state
      rmSync(join(dir, `${ID}.json`));
      const cl3 = client();
      cl3.execute.mockResolvedValue(intent());
      cl3.executeApproved.mockImplementation(sender(c, "sigPAY2"));
      await run(c, cl3, { onPause: recordIntent });
      expect(JSON.parse(readFileSync(join(dir, `${ID}.json`), "utf8"))).toMatchObject({ mode: "approved", signature: "sigPAY2", blockhash: "bhNEW" });
    });

    it("stays paused without an approver, and never executes", async () => {
      const cl = client();
      cl.execute.mockResolvedValue(intent());
      expect(await run(conn(), cl)).toMatchObject({ status: "paused", approvalId: "ab".repeat(32) });
      expect(cl.executeApproved).not.toHaveBeenCalled();
    });

    it("refuses an approved intent that is not exactly the snapshot", async () => {
      for (const over of [{ amount: 5_000_001n }, { recipient: Keypair.generate().publicKey }, { nonce: Buffer.alloc(16) }, { agent: Keypair.generate().publicKey }, { authority: Keypair.generate().publicKey }, { mint: Keypair.generate().publicKey }, { programId: Keypair.generate().publicKey }]) {
        const cl = client();
        cl.execute.mockResolvedValue(intent(over));
        await expect(run(conn(), cl, { onPause: async () => {} })).rejects.toMatchObject({ code: "INTENT_MISMATCH" });
        expect(cl.executeApproved).not.toHaveBeenCalled();
      }
    });

    it("revalidates after waiting: a package that expired meanwhile is not executed", async () => {
      const cl = client();
      cl.execute.mockResolvedValue(intent());
      let t = 1_800_000_000;
      cl.waitForApproval.mockImplementation(async () => void (t = 4_000_000_001));
      await expect(run(conn(), cl, { now: () => t, onPause: async () => {} })).rejects.toMatchObject({ code: "EXPIRED" });
      expect(cl.executeApproved).not.toHaveBeenCalled();
    });
  });

  it("builds PDAs only from validated data: client factory receives the payer authority", async () => {
    const c = conn();
    const cl = client();
    cl.execute.mockImplementation(sender(c, "sigC"));
    const makeClient = vi.fn((_: PublicKey) => cl);
    await executePackage({ pkg, agent: parties.agent.publicKey, connection: c, makeClient, stateDir: dir, now: () => 1_800_000_000 });
    expect(makeClient.mock.calls[0]![0].toBase58()).toBe(pkg.snapshot.payerAuthority);
  });
});
