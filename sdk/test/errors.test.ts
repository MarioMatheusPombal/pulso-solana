import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ANCHOR_ACCOUNT_NOT_INITIALIZED, PULSO_ERRORS, pulsoErrorFromCode } from "../src/index.js";

// Parse the on-chain enum so the two sides cannot drift apart silently.
const rust = readFileSync(
  fileURLToPath(new URL("../../programs/pulso/src/error.rs", import.meta.url)),
  "utf8",
);
const onChain = [...rust.matchAll(/#\[msg\("([^"]+)"\)\]\s*(\w+),/g)].map((m, i) => ({
  name: m[2],
  code: 6000 + i,
  message: m[1],
}));

describe("PULSO_ERRORS", () => {
  it("matches the on-chain enum: same names, codes and messages, in order", () => {
    expect(onChain.length).toBeGreaterThanOrEqual(11);
    expect(Object.values(PULSO_ERRORS).map(({ name, code, message }) => ({ name, code, message }))).toEqual(onChain);
  });

  it("marks exactly the first 11 as spec codes PULSO_001..011", () => {
    const spec = Object.values(PULSO_ERRORS).filter((e) => e.spec);
    expect(spec).toHaveLength(11);
    spec.forEach((e, i) => {
      expect(e.code).toBe(6000 + i);
      expect(e.message.startsWith(`PULSO_${String(i + 1).padStart(3, "0")}_`)).toBe(true);
    });
  });

  it("looks errors up by code", () => {
    expect(pulsoErrorFromCode(6002)).toBe(PULSO_ERRORS.HumanIntentRequired);
    expect(pulsoErrorFromCode(6005)?.message).toBe("PULSO_006_INTENT_MISMATCH");
    expect(pulsoErrorFromCode(ANCHOR_ACCOUNT_NOT_INITIALIZED)).toBeUndefined();
    expect(pulsoErrorFromCode(1)).toBeUndefined();
  });
});
