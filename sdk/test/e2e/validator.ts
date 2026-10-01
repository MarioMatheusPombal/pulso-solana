import { resolve } from "node:path";
import { startValidator as start, type LocalValidator } from "../../../agent-demo/src/validator.js";
import { PROGRAM_ID } from "../../src/program.js";

export type { LocalValidator };
export const RPC_URL = "http://127.0.0.1:8999";

/** Boots solana-test-validator with the built program. Requires `pnpm build` first. */
export const startValidator = () =>
  start({
    programId: PROGRAM_ID.toBase58(),
    soPath: resolve(import.meta.dirname, "../../../target/deploy/pulso.so"),
    rpcPort: 8999,
    faucetPort: 9999,
  });
