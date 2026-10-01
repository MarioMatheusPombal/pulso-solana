import { describe, expect, it } from "vitest";
import { explainPulsoError, PULSO_ERROR_EXPLANATIONS, readableAppError } from "../lib/errors";

describe("PULSO error explanations", () => {
  it("gives every spec code its own explanation", () => {
    const entries = Object.entries(PULSO_ERROR_EXPLANATIONS);
    expect(entries).toHaveLength(11);
    expect(new Set(entries.map(([, explanation]) => explanation)).size).toBe(11);
    for (const [code, explanation] of entries) expect(explainPulsoError(code)).toBe(explanation);
  });

  it("adds a readable explanation when a program code appears in an error", () => {
    expect(readableAppError(new Error("Transaction failed: PULSO_003_HUMAN_INTENT_REQUIRED")))
      .toContain("authorize this exact transfer");
    expect(readableAppError("custom program error: 0x1771"))
      .toContain("PULSO_002_POLICY_DISABLED");
    expect(readableAppError('InstructionError: {"Custom":6005}'))
      .toContain("human-authorized action");
    expect(readableAppError("AnchorError caused by account: policy. Error Number: 3012"))
      .toContain("No on-chain policy exists");
  });

  it("preserves unknown RPC details and labels unknown PULSO codes", () => {
    expect(readableAppError("Blockhash not found")).toBe("Blockhash not found");
    expect(readableAppError("PULSO_999_FUTURE_ERROR")).toContain("Unrecognized PULSO program error.");
    const vaultError = readableAppError("AnchorError caused by account: vault. Error Number: 3012");
    expect(vaultError).toContain("required on-chain account has not been initialized");
    expect(vaultError).not.toContain("No on-chain policy exists");
    const contextFreeError = readableAppError("Error Number: 3012");
    expect(contextFreeError).toContain("required on-chain account has not been initialized");
    expect(contextFreeError).not.toContain("No on-chain policy exists");
  });
});
