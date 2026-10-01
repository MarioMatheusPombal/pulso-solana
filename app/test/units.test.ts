import { describe, expect, it } from "vitest";
import { formatUnits, parseUnits } from "../lib/units";

describe("parseUnits", () => {
  it("converts to base units", () => {
    expect(parseUnits("10")).toEqual({ value: 10_000_000n });
    expect(parseUnits("0.000001")).toEqual({ value: 1n });
    expect(parseUnits(" 1.5 ")).toEqual({ value: 1_500_000n });
    expect(parseUnits("12345678901234.123456")).toEqual({ value: 12345678901234123456n });
  });
  it("rejects bad input", () => {
    for (const s of ["", "  ", "-1", "1.0000001", "abc", "1e3", ".", "1,5"]) expect("error" in parseUnits(s)).toBe(true);
  });
});

describe("formatUnits", () => {
  it("formats", () => {
    expect(formatUnits(10_000_000n)).toBe("10.00");
    expect(formatUnits(1n)).toBe("0.000001");
    expect(formatUnits(10_500_000n)).toBe("10.50");
    expect(formatUnits(0n)).toBe("0.00");
  });
});
