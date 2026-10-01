export const PULSO_ERROR_EXPLANATIONS = {
  PULSO_001_POLICY_NOT_FOUND: "No on-chain policy exists for this authority and agent.",
  PULSO_002_POLICY_DISABLED: "The human disabled this policy.",
  PULSO_003_HUMAN_INTENT_REQUIRED: "Policy requires the human to authorize this exact transfer.",
  PULSO_004_INTENT_EXPIRED: "The human authorization expired.",
  PULSO_005_INTENT_ALREADY_USED: "The authorization has no remaining uses.",
  PULSO_006_INTENT_MISMATCH: "The attempted transfer does not match the human-authorized action.",
  PULSO_007_RECIPIENT_NOT_ALLOWED: "The recipient is outside the agent's allowed scope.",
  PULSO_008_AMOUNT_EXCEEDS_LIMIT: "The transfer exceeds the policy's per-transaction limit.",
  PULSO_009_DAILY_LIMIT_EXCEEDED: "The transfer exceeds the policy's daily limit.",
  PULSO_010_UNAUTHORIZED_AGENT: "The signing agent is not authorized by this policy.",
  PULSO_011_POLICY_CHANGE_FORBIDDEN: "Only the human authority can change this policy.",
} as const;

export type PulsoSpecErrorCode = keyof typeof PULSO_ERROR_EXPLANATIONS;

const codes = Object.keys(PULSO_ERROR_EXPLANATIONS) as PulsoSpecErrorCode[];

export function explainPulsoError(code: string): string | undefined {
  return PULSO_ERROR_EXPLANATIONS[code as PulsoSpecErrorCode];
}

/** Adds context for known program errors and preserves useful details for unknown RPC errors. */
export function readableAppError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = codes.find((candidate) => message.includes(candidate));
  if (code) return message.replaceAll(code, `${code}: ${PULSO_ERROR_EXPLANATIONS[code]}`);

  const numeric = message.match(/(?:custom program error:\s*(0x[\da-f]+)|error (?:number|code):\s*(\d+)|["']?Custom["']?\s*:\s*(\d+))/i);
  const numericCode = numeric?.[1] ? Number.parseInt(numeric[1], 16) : Number(numeric?.[2] ?? numeric?.[3]);
  if (numericCode === 3012) {
    if (/account\s*:\s*policy\b|policy account/i.test(message)) {
      const code: PulsoSpecErrorCode = "PULSO_001_POLICY_NOT_FOUND";
      return `${PULSO_ERROR_EXPLANATIONS[code]} (${code}). ${message}`;
    }
    return `A required on-chain account has not been initialized. ${message}`;
  }
  if (numericCode >= 6000 && numericCode <= 6010) {
    const matched = codes[numericCode - 6000];
    const explanation = PULSO_ERROR_EXPLANATIONS[matched];
    return `${explanation} (${matched}, code ${numericCode}). ${message}`;
  }

  if (/PULSO_\d{3}_[A-Z0-9_]+/.test(message)) return `Unrecognized PULSO program error. ${message}`;
  return message;
}
