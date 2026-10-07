import { PROGRAM_ID } from "@pulso/sdk";
import { Keypair } from "@solana/web3.js";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runB2BDemo } from "../src/b2b-demo.js";
import { startValidator, type LocalValidator } from "../src/validator.js";

// NOT AUDITED · DEVNET DEMONSTRATION ONLY
// Deterministic rehearsal of the B2B demo against a real local validator (issue 312).
let validator: LocalValidator;
beforeAll(async () => {
  validator = await startValidator({ programId: PROGRAM_ID.toBase58(), soPath: resolve(import.meta.dirname, "../../target/deploy/pulso.so"), rpcPort: 8899, faucetPort: 9900 });
});
afterAll(async () => {
  await validator?.stop();
});

describe("B2B demo scenario (localnet)", () => {
  it("runs the whole story, shows every failure, and never leaks a key", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const lines: string[] = [];
    const networkDir = join(resolve(import.meta.dirname, "../../.demo"), "b2b-demo-test-network");
    const r = await runB2BDemo({ cluster: "localnet", keys: { "a-authority": a, "b-authority": b }, networkDir, log: (l) => lines.push(l) });

    expect(r.authorities).toEqual({ a: a.publicKey.toBase58(), b: b.publicKey.toBase58() });
    expect(r.programId).toBe(PROGRAM_ID.toBase58());
    // 5 + 8 + 100 moved, nothing else (the failure scenes move no money)
    expect(r.balances.vaultBefore - r.balances.vaultAfter).toBe(113_000_000n);
    expect(r.balances.receiverAfter - r.balances.receiverBefore).toBe(113_000_000n);
    expect(r.signatures).toHaveLength(4);
    expect(new Set(r.signatures.map((s) => s.signature)).size).toBe(4);

    expect(r.main.status).toBe("verificado");
    expect(r.main.receiptPath).toBe(`/receipt/${r.main.paymentSignature}`);
    expect(r.main.actionHash).toMatch(/^[0-9a-f]{64}$/);

    expect(r.failures.program).toBe("PULSO_008_AMOUNT_EXCEEDS_LIMIT");
    expect(r.failures.replay).toBe("PULSO_005_INTENT_ALREADY_USED");
    expect(r.failures.consentMissing).toBe("RECEIVER_CONSENT_REQUIRED");
    expect(r.failures.tampered).toEqual(["DIGEST_MISMATCH", "CONSENT_TERMS_MISMATCH"]);
    expect(r.failures.expired).toBe("EXPIRED");
    expect(r.failures.expiredStatus).toBe("expirado");

    const text = lines.join("\n");
    expect(text).toContain("HUMAN_INTENT_REQUIRED");
    expect(text).toContain("WALLET FIXTURE, not the agent");
    expect(text).toContain(`action hash  ${r.main.actionHash}`);
    expect(text).toContain("does NOT authorize spending");
    expect(text).toContain("does not stop the agent's spending");
    expect(lines.at(-1)).toBe("NOT AUDITED · DEVNET DEMONSTRATION ONLY");

    // no secret in the log or in the stored network files (the agent state dir is removed at the end of the run)
    const secrets = [a, b].flatMap((k) => [Buffer.from(k.secretKey).toString("hex"), Buffer.from(k.secretKey).toString("base64"), JSON.stringify(Array.from(k.secretKey))]);
    const stored = readdirSync(networkDir).map((f) => readFileSync(join(networkDir, f), "utf8"));
    for (const t of [text, ...stored]) for (const s of secrets) expect(t.includes(s)).toBe(false);
  });
});
