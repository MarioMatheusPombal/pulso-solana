import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Connection } from "@solana/web3.js";

export interface LocalValidator {
  connection: Connection;
  /** Kills the validator and resolves once the process is gone (so the ports are free again). */
  stop: () => Promise<void>;
}

export interface ValidatorOptions {
  programId: string;
  /** Path to the built program (`target/deploy/pulso.so`). */
  soPath: string;
  rpcPort: number;
  faucetPort: number;
  gossipPort?: number;
  dynamicPortRange?: string;
}

/** Boots a fresh solana-test-validator with the program preloaded. Shared by the SDK e2e tests and the demo. */
export async function startValidator(o: ValidatorOptions): Promise<LocalValidator> {
  const ledger = mkdtempSync(join(tmpdir(), "pulso-ledger-"));
  const child: ChildProcess = spawn(
    "solana-test-validator",
    [
      "--reset", "--quiet",
      ...(o.gossipPort === undefined ? [] : ["--gossip-port", String(o.gossipPort)]),
      ...(o.dynamicPortRange === undefined ? [] : ["--dynamic-port-range", o.dynamicPortRange]),
      "--ledger", ledger,
      "--rpc-port", String(o.rpcPort),
      "--faucet-port", String(o.faucetPort),
      "--bpf-program", o.programId, o.soPath,
    ],
    { stdio: "ignore" },
  );
  let exited = false;
  const gone = new Promise<void>((r) => {
    child.on("exit", () => ((exited = true), r()));
    child.on("error", () => ((exited = true), r()));
  });
  const stop = async () => {
    if (!exited) child.kill("SIGKILL");
    await gone;
    rmSync(ledger, { recursive: true, force: true });
  };

  const connection = new Connection(`http://127.0.0.1:${o.rpcPort}`, "confirmed");
  const deadline = Date.now() + 90_000;
  try {
    for (;;) {
      if (exited) throw new Error("solana-test-validator exited early (is it on PATH? was `pnpm build` run?)");
      if (Date.now() > deadline) throw new Error("solana-test-validator not ready after 90s");
      try {
        if ((await connection.getSlot()) > 5) break;
      } catch {
        // not up yet
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  } catch (e) {
    await stop();
    throw e;
  }
  return { connection, stop };
}
