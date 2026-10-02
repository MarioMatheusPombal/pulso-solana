// Human units <-> base units. Strings and bigint only, never floats.

export const DECIMALS = 6;

/** "10.5" -> 10500000n. Rejects empty, negative, non-numeric and more than `decimals` places. */
export function parseUnits(input: string, decimals = DECIMALS): { value: bigint } | { error: string } {
  const s = input.trim();
  if (s === "") return { error: "Enter an amount." };
  if (s.startsWith("-")) return { error: "Amount cannot be negative." };
  const m = /^(\d+)(?:\.(\d*))?$/.exec(s);
  if (!m) return { error: "Amount must be a plain decimal number." };
  const frac = m[2] ?? "";
  if (frac.length > decimals) return { error: `At most ${decimals} decimal places.` };
  return { value: BigInt(m[1] + frac.padEnd(decimals, "0")) };
}

/** 10500000n -> "10.50". Always at least 2 places; more only when needed. */
export function formatUnits(v: bigint, decimals = DECIMALS): string {
  if (decimals === 0) return v.toString();
  const neg = v < 0n;
  const abs = neg ? -v : v;
  const s = abs.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, s.length - decimals);
  let frac = s.slice(s.length - decimals).replace(/0+$/, "");
  frac = frac.padEnd(2, "0");
  return `${neg ? "-" : ""}${int}.${frac}`;
}
