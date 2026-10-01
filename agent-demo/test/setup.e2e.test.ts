import { getAccount } from "@solana/spl-token";
import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "@pulso/sdk";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadAddresses, setup, usdc } from "../src/setup.js";
import { startValidator, type LocalValidator } from "../src/validator.js";

let v: LocalValidator;
beforeAll(async () => {
  v = await startValidator({
    programId: PROGRAM_ID.toBase58(),
    soPath: resolve(import.meta.dirname, "../../target/deploy/pulso.so"),
    rpcPort: 8899,
    faucetPort: 9900,
  });
});
afterAll(() => v?.stop());

describe("setup (issue 91)", () => {
  it("is idempotent: the second run changes neither addresses nor the vault balance", async () => {
    const first = await setup({ cluster: "localnet" });
    const balance1 = (await getAccount(v.connection, new PublicKey(first.vault))).amount;
    expect(balance1).toBe(usdc(500));

    const second = await setup({ cluster: "localnet" });
    expect(second).toEqual(first);
    expect((await getAccount(v.connection, new PublicKey(second.vault))).amount).toBe(balance1);
    expect(loadAddresses("localnet")).toEqual(first);
  });
});
