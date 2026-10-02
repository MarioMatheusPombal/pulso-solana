import { PROGRAM_ID, getProgram } from "@pulso/sdk";
import anchor from "@anchor-lang/core";
import { getAccount } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { runAgent, type AgentResult } from "./agent.js";
import { loadKeypair, setup, usdc } from "./setup.js";
import { startValidator, type LocalValidator } from "./validator.js";
import { runScenarioC, type ScenarioCResult } from "./scenario-c.js";
import { runScenarioD, type ScenarioDResult } from "./scenario-d.js";
import { runScenarioE, type ScenarioEResult } from "./scenario-e.js";
import { runScenarioF, type ScenarioFResult } from "./scenario-f.js";

const { BN } = anchor;

const SO_PATH = resolve(import.meta.dirname, "../../target/deploy/pulso.so");
const RPC_PORT = 8899;
const FAUCET_PORT = 9900;
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;

export interface DemoOptions {
  /** `auto` signs with the generated localnet fixture in this process; `ui` waits for the authority wallet in the app. */
  approve?: "auto" | "ui";
  approvalsUrl?: string;
  /** Optional display-only SDK activity endpoint, also read from PULSO_ACTIVITY_URL. */
  activityUrl?: string;
  scenario?: "AB" | "C" | "D" | "E" | "F";
  log?: (line: string) => void;
}

export interface DemoResult {
  scenarioA: AgentResult;
  scenarioB: AgentResult;
  /** Base units that left the vault / reached the merchant across both scenarios. */
  vaultDelta: bigint;
  merchantDelta: bigint;
}

export interface ScenarioCDemoResult {
  scenarioC: ScenarioCResult;
}

export interface ScenarioDDemoResult {
  scenarioD: ScenarioDResult;
}

export interface ScenarioEDemoResult {
  scenarioE: ScenarioEResult;
}

export interface ScenarioFDemoResult {
  scenarioF: ScenarioFResult;
}

export interface FullDemoResult {
  scenarioAB: DemoResult;
  scenarioC: ScenarioCResult;
  scenarioD: ScenarioDResult;
  scenarioE: ScenarioEResult;
  scenarioF: ScenarioFResult;
}

async function rpcAnswers(): Promise<boolean> {
  try {
    await new Connection(RPC_URL).getVersion();
    return true;
  } catch {
    return false;
  }
}

/** One command for scenarios A–E; F runs only its focused Rust LiteSVM test without starting RPC. */
export function runDemo(o: DemoOptions & { scenario: "C" }): Promise<ScenarioCDemoResult>;
export function runDemo(o: DemoOptions & { scenario: "D" }): Promise<ScenarioDDemoResult>;
export function runDemo(o: DemoOptions & { scenario: "E" }): Promise<ScenarioEDemoResult>;
export function runDemo(o: DemoOptions & { scenario: "F" }): Promise<ScenarioFDemoResult>;
export function runDemo(o?: DemoOptions & { scenario?: "AB" }): Promise<DemoResult>;
export async function runDemo(o: DemoOptions = {}): Promise<DemoResult | ScenarioCDemoResult | ScenarioDDemoResult | ScenarioEDemoResult | ScenarioFDemoResult> {
  const log = o.log ?? console.log;
  const mode = o.approve ?? "auto";
  if (o.scenario === "F") {
    log("\n=== Scenario F — expiry enforced by the on-chain program (LiteSVM) ===");
    const scenarioF = runScenarioF(log);
    log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
    return { scenarioF };
  }
  if (!existsSync(SO_PATH)) throw new Error("target/deploy/pulso.so not found. Run `pnpm build` first.");

  let validator: LocalValidator | undefined;
  const shutdown = () => void validator?.stop();
  process.once("SIGINT", () => (shutdown(), process.exit(130)));
  process.once("SIGTERM", () => (shutdown(), process.exit(143)));
  try {
    if (!(await rpcAnswers())) {
      log("Starting local validator with the PULSO program…");
      validator = await startValidator({ programId: PROGRAM_ID.toBase58(), soPath: SO_PATH, rpcPort: RPC_PORT, faucetPort: FAUCET_PORT });
    }
    const addresses = await setup({ cluster: "localnet" });
    const connection = new Connection(addresses.rpcUrl, "confirmed");
    const activityUrl = o.activityUrl ?? (process.env.PULSO_ACTIVITY_URL?.trim() || undefined);
    if (o.scenario === "C") {
      log("\n=== Scenario C — authorize 100 USDC, tamper to 150 USDC ===");
      const scenarioC = await runScenarioC(addresses, log, activityUrl);
      log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
      return { scenarioC };
    }
    if (o.scenario === "D") {
      log("\n=== Scenario D — authorize merchant, tamper to another recipient ===");
      const scenarioD = await runScenarioD(addresses, log, activityUrl);
      log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
      return { scenarioD };
    }
    if (o.scenario === "E") {
      log("\n=== Scenario E — concurrent replay of a one-use authorization ===");
      const scenarioE = await runScenarioE(addresses, log, activityUrl);
      log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
      return { scenarioE };
    }
    const merchant = new PublicKey(addresses.merchantTokenAccount);
    const bal = async (a: string | PublicKey) => (await getAccount(connection, new PublicKey(a))).amount;
    const vaultStart = await bal(addresses.vault);
    const merchantStart = await bal(merchant);

    log("\n=== Scenario A — 5 USDC, below the approval threshold ===");
    const scenarioA = await runAgent({
      addresses,
      log,
      activityUrl,
      actions: [{ label: "Scenario A", amount: usdc(5), recipient: merchant }],
    });

    log("\n=== Scenario B — 100 USDC, above the threshold: needs the human ===");
    const scenarioB = await runAgent({
      addresses,
      log,
      approvalsUrl: mode === "ui" ? o.approvalsUrl ?? "http://localhost:3000" : undefined,
      activityUrl,
      waitOptions: mode === "ui" ? { timeoutMs: 300_000 } : { timeoutMs: 30_000, initialDelayMs: 200, maxDelayMs: 1_000 },
      actions: [{ label: "Scenario B", amount: usdc(100), recipient: merchant }],
      onPause: async (pending) => {
        if (mode === "ui") {
          log(`    open ${pending.approvalUrl ?? "the approvals app"} to approve; waiting…`);
          return;
        }
        // Localnet fixture simulates the authority. The agent client uses only the authority public key.
        const human = loadKeypair("localnet", "human");
        log("  ✎ localnet fixture signs record_intent (simulated human approval)");
        const sig = await getProgram(connection, human)
          .methods.recordIntent(Array.from(pending.intent.actionHash), new BN(pending.intent.fields.expiresAt.toString()), pending.intent.fields.maxUses)
          .accountsPartial({ authority: human.publicKey, policy: new PublicKey(addresses.policy) })
          .rpc();
        log(`    approval recorded on-chain  sig=${sig.slice(0, 12)}…`);
      },
    });

    const vaultDelta = vaultStart - (await bal(addresses.vault));
    const merchantDelta = (await bal(merchant)) - merchantStart;
    const stepA = scenarioA.steps[0];
    if (scenarioA.steps.length !== 1 || !stepA || stepA.decision !== "EXECUTED" || stepA.approved !== undefined) {
      throw new Error(`Scenario A expected autonomous execution; got ${stepA?.decision ?? "no result"}${stepA?.error ? ` (${stepA.error})` : ""}`);
    }
    const stepB = scenarioB.steps[0];
    if (scenarioB.steps.length !== 1 || !stepB || stepB.decision !== "EXECUTED" || stepB.approved !== true) {
      throw new Error(`Scenario B expected execution after approval; got ${stepB?.decision ?? "no result"}${stepB?.error ? ` (${stepB.error})` : ""}`);
    }
    if (vaultDelta !== usdc(105) || merchantDelta !== usdc(105)) {
      throw new Error(`Unexpected balances: vault −${vaultDelta / usdc(1)} USDC, merchant +${merchantDelta / usdc(1)} USDC; expected 105 USDC each`);
    }
    log("");
    log(`Done. Vault −${vaultDelta / usdc(1)} USDC, merchant +${merchantDelta / usdc(1)} USDC.`);
    log("NOT AUDITED · DEVNET DEMONSTRATION ONLY");
    return { scenarioA, scenarioB, vaultDelta, merchantDelta };
  } finally {
    await validator?.stop();
  }
}

/** Run A/B, then each attack/replay against a freshly reset local validator, and finish with F in LiteSVM. */
export async function runAllScenarios(log: (line: string) => void = console.log): Promise<FullDemoResult> {
  if (await rpcAnswers()) {
    throw new Error("Full A–F demo requires local RPC port 8899 to be free; stop the existing validator and retry. It was left running, and no scenario was started.");
  }
  log("PULSO full demo: localnet scenarios A–E; Scenario F runs in LiteSVM.");
  log("Each localnet scenario starts from a reset validator and creates its own policy.");
  const scenarioAB = await runDemo({ scenario: "AB", approve: "auto", log });
  log("\n✓ A PASS — autonomous 5 USDC transfer below the threshold");
  log("✓ B PASS — 100 USDC paused, approved, and executed");

  const scenarioC = (await runDemo({ scenario: "C", log })).scenarioC;
  log(`✓ C PASS — confirmed ${scenarioC.error} (${scenarioC.errorCode}) for the amount tamper`);
  const scenarioD = (await runDemo({ scenario: "D", log })).scenarioD;
  log(`✓ D PASS — confirmed ${scenarioD.error} (${scenarioD.errorCode}) for the recipient tamper`);
  const scenarioE = (await runDemo({ scenario: "E", log })).scenarioE;
  log(`✓ E PASS — one transfer; concurrent and sequential replays confirmed ${"PULSO_005_INTENT_ALREADY_USED"} (${scenarioE.errorCode})`);
  const scenarioF = (await runDemo({ scenario: "F", log })).scenarioF;
  log(`✓ F PASS — LiteSVM simulation confirmed PULSO_004_INTENT_EXPIRED (${scenarioF.errorCode}) at expires_at + 1`);
  log("\nAll PULSO scenarios A–F passed.");
  return { scenarioAB, scenarioC, scenarioD, scenarioE, scenarioF };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((x) => x !== "--"),
    options: {
      approve: { type: "string", default: "auto" },
      "approvals-url": { type: "string", default: "http://localhost:3000" },
      all: { type: "boolean", default: false },
      scenario: { type: "string", default: "AB" },
    },
  });
  if (values.scenario !== "AB" && values.scenario !== "C" && values.scenario !== "D" && values.scenario !== "E" && values.scenario !== "F") {
    console.error("--scenario must be AB, C, D, E, or F");
    process.exit(1);
  }
  if (values.approve !== "auto" && values.approve !== "ui") {
    console.error("--approve must be auto or ui");
    process.exit(1);
  }
  if (values.all && values.approve !== "auto") {
    console.error("--all requires --approve auto (the local demo fixture records the human approval)");
    process.exit(1);
  }
  if (values.all && values.scenario !== "AB") {
    console.error("--all cannot be combined with --scenario");
    process.exit(1);
  }
  // Brand header for whoever watches the terminal. Plain text when piped or when NO_COLOR is set.
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  const amber = (text: string) => (color ? `[38;2;255;176;32m${text}[0m` : text);
  console.log(`${amber("▁▁▁▁▁▁▂▁▁█▁▃▁▁▁▁▁▁  PULSO")} · human authorization for AI agents`);
  console.log("The agent holds the wallet. The human holds the authority.");
  console.log(`${amber("NOT AUDITED · DEVNET DEMONSTRATION ONLY")}
`);

  // Exit explicitly: web3.js websocket subscriptions would keep retrying against the validator we just stopped.
  const run = values.all
    ? runAllScenarios()
    : values.scenario === "C"
    ? runDemo({ scenario: "C" })
    : values.scenario === "D"
      ? runDemo({ scenario: "D" })
      : values.scenario === "E"
        ? runDemo({ scenario: "E" })
        : values.scenario === "F"
          ? runDemo({ scenario: "F" })
          : runDemo({ scenario: "AB", approve: values.approve, approvalsUrl: values["approvals-url"] });
  run
    .then(() => process.exit(0))
    .catch((e: Error) => {
      console.error(`demo failed: ${e.message}`);
      process.exit(1);
    });
}
