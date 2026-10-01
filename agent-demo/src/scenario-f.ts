import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const RUST_TEST = "intent_valid_at_expires_at_and_expired_one_second_later";
const RESULT = /PULSO_LITESVM_SCENARIO_F code=(\d+) expires_at=(-?\d+) clock=(-?\d+) vault=(\d+) recipient=(\d+) spent=(\d+) used_count=(\d+)/;

export interface ScenarioFResult {
  runtime: "LiteSVM";
  errorCode: number;
  expiresAt: number;
  clock: number;
  vault: bigint;
  recipient: bigint;
  spent: bigint;
  usedCount: number;
}

/** Run the focal Rust LiteSVM expiry test; this is a simulated receipt, not an RPC transaction. */
export function runScenarioF(log: (line: string) => void = () => {}): ScenarioFResult {
  const repoRoot = resolve(import.meta.dirname, "../../");
  const cargo = spawnSync(
    "cargo",
    ["test", "-p", "pulso", "--test", "execute_transfer", RUST_TEST, "--", "--exact", "--nocapture"],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
  );
  if (cargo.error) throw cargo.error;
  if (cargo.status !== 0) {
    throw new Error(`LiteSVM expiry test failed (exit ${cargo.status}):\n${cargo.stdout}\n${cargo.stderr}`);
  }

  const match = `${cargo.stdout}\n${cargo.stderr}`.match(RESULT);
  if (!match) throw new Error("LiteSVM expiry test passed without its structured Scenario F result");
  const [, code, expiresAt, clock, vault, recipient, spent, usedCount] = match;
  const result: ScenarioFResult = {
    runtime: "LiteSVM",
    errorCode: Number(code),
    expiresAt: Number(expiresAt),
    clock: Number(clock),
    vault: BigInt(vault!),
    recipient: BigInt(recipient!),
    spent: BigInt(spent!),
    usedCount: Number(usedCount),
  };
  if (
    result.errorCode !== 6003
    || result.clock !== result.expiresAt + 1
    || result.vault !== 9_300n
    || result.recipient !== 700n
    || result.spent !== 700n
    || result.usedCount !== 1
  ) throw new Error(`Unexpected LiteSVM expiry result: ${match[0]}`);

  log(`  ✓ LiteSVM Clock advanced to expires_at + 1 (${result.clock}); no wall-clock wait`);
  log(`  ✓ simulated on-chain result PULSO_004_INTENT_EXPIRED (${result.errorCode})`);
  log(`  ✓ LiteSVM balances/spending unchanged by expired attempt: vault=${result.vault}, recipient=${result.recipient}, spent=${result.spent}, used_count=${result.usedCount}`);
  return result;
}
