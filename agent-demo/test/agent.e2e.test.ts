import { PROGRAM_ID } from "@pulso/sdk";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { defaultActions, runAgent, type AgentResult } from "../src/agent.js";
import { setup } from "../src/setup.js";
import { startValidator } from "../src/validator.js";

// One fresh ledger per run: the same sequence must give the same decisions every time.
async function freshRun(): Promise<{ result: AgentResult; lines: string[] }> {
  const v = await startValidator({
    programId: PROGRAM_ID.toBase58(),
    soPath: resolve(import.meta.dirname, "../../target/deploy/pulso.so"),
    rpcPort: 8899,
    faucetPort: 9900,
  });
  try {
    const addresses = await setup({ cluster: "localnet" });
    const lines: string[] = [];
    const result = await runAgent({ addresses, actions: defaultActions(addresses), log: (l) => lines.push(l) });
    return { result, lines };
  } finally {
    await v.stop();
  }
}

const strip = (r: AgentResult) => ({ ...r, steps: r.steps.map(({ signature: _s, ...rest }) => rest) });
// Status lines only: drop payload details (expiry, nonce, hash) and signatures.
const statusLines = (lines: string[]) =>
  lines.filter((l) => /^(▸|  [♥⏸✕]|Vault)/u.test(l)).map((l) => l.replace(/sig=\S+/, "sig=…"));

describe("deterministic agent (issue 109)", () => {
  it("decides beat, pause and valve closed, and two clean runs give the same result", async () => {
    const first = await freshRun();
    expect(first.result.steps.map((s) => s.decision)).toEqual(["EXECUTED", "PAUSED", "REJECTED"]);
    expect(first.result.steps[2]!.error).toBe("PULSO_008_AMOUNT_EXCEEDS_LIMIT");
    expect(first.result.vaultBefore).toBe("500.00");
    expect(first.result.vaultAfter).toBe("495.00");
    expect(first.result.spentInWindow).toBe("5.00");

    const second = await freshRun();
    expect(strip(second.result)).toEqual(strip(first.result));
    expect(statusLines(second.lines)).toEqual(statusLines(first.lines));
  });
});
