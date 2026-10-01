// PULSO error codes. Mirrors programs/pulso/src/error.rs: an Anchor error code is
// 6000 + the variant's position, so PULSO_00N is always 6000 + N - 1.

export interface PulsoError {
  /** Variant name in the on-chain enum. */
  name: string;
  /** Anchor custom error code returned by the program. */
  code: number;
  /** Message returned by the program; for the first 11, the spec code. */
  message: string;
  /** True for the 11 codes of the policy and intent spec. */
  spec: boolean;
}

const define = <const N extends string>(name: N, code: number, message: string, spec: boolean) =>
  ({ name, code, message, spec }) as const satisfies PulsoError;

export const PULSO_ERRORS = {
  PolicyNotFound: define("PolicyNotFound", 6000, "PULSO_001_POLICY_NOT_FOUND", true),
  PolicyDisabled: define("PolicyDisabled", 6001, "PULSO_002_POLICY_DISABLED", true),
  HumanIntentRequired: define("HumanIntentRequired", 6002, "PULSO_003_HUMAN_INTENT_REQUIRED", true),
  IntentExpired: define("IntentExpired", 6003, "PULSO_004_INTENT_EXPIRED", true),
  IntentAlreadyUsed: define("IntentAlreadyUsed", 6004, "PULSO_005_INTENT_ALREADY_USED", true),
  IntentMismatch: define("IntentMismatch", 6005, "PULSO_006_INTENT_MISMATCH", true),
  RecipientNotAllowed: define("RecipientNotAllowed", 6006, "PULSO_007_RECIPIENT_NOT_ALLOWED", true),
  AmountExceedsLimit: define("AmountExceedsLimit", 6007, "PULSO_008_AMOUNT_EXCEEDS_LIMIT", true),
  DailyLimitExceeded: define("DailyLimitExceeded", 6008, "PULSO_009_DAILY_LIMIT_EXCEEDED", true),
  UnauthorizedAgent: define("UnauthorizedAgent", 6009, "PULSO_010_UNAUTHORIZED_AGENT", true),
  PolicyChangeForbidden: define("PolicyChangeForbidden", 6010, "PULSO_011_POLICY_CHANGE_FORBIDDEN", true),
  // Outside the spec: always after the first 11.
  InvalidPolicyLimits: define("InvalidPolicyLimits", 6011, "Invalid policy limits", false),
  InvalidIntent: define("InvalidIntent", 6012, "Invalid intent: expires_at must be in the future and max_uses > 0", false),
  IntentRevoked: define("IntentRevoked", 6013, "Intent revoked", false),
} as const;

export type PulsoErrorName = keyof typeof PULSO_ERRORS;

const BY_CODE = new Map<number, PulsoError>(Object.values(PULSO_ERRORS).map((e) => [e.code, e]));

/** The PULSO error for an Anchor custom error code, or `undefined` if it is not one. */
export function pulsoErrorFromCode(code: number): PulsoError | undefined {
  return BY_CODE.get(code);
}

/**
 * Anchor's AccountNotInitialized. A policy that does not exist fails this account check
 * before any program code runs, so the program can never return 6000 itself: treat this
 * code on the `policy` account as PULSO_001_POLICY_NOT_FOUND.
 */
export const ANCHOR_ACCOUNT_NOT_INITIALIZED = 3012;

/** A PULSO program error surfaced by the SDK, carrying the matching `PULSO_ERRORS` entry. */
export class PulsoProgramError extends Error {
  constructor(readonly error: PulsoError) {
    super(`${error.message} (${error.name}, code ${error.code})`);
    this.name = "PulsoProgramError";
  }
}

/** The human denied the approval request. */
export class ApprovalDeniedError extends Error {
  constructor(readonly approvalId: string) {
    super(`Approval ${approvalId} was denied by the human`);
    this.name = "ApprovalDeniedError";
  }
}

/** No approval showed up on-chain before the timeout. */
export class ApprovalTimeoutError extends Error {
  constructor(readonly approvalId: string, readonly timeoutMs: number) {
    super(`Approval ${approvalId} not granted within ${timeoutMs} ms`);
    this.name = "ApprovalTimeoutError";
  }
}
