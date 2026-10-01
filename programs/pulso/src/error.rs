//! Program errors, mapped to PULSO_001..011 of the policy and intent spec.
//!
//! Numbering rule: an Anchor error code is 6000 + the variant's position in this enum,
//! so PULSO_00N is always 6000 + N - 1 (PULSO_001 = 6000 ... PULSO_011 = 6010).
//! The order is load-bearing and part of the public interface: never reorder or insert.
//! Errors outside the spec go AFTER the first 11 (6011 and up).
//!
//! One spec code cannot come from this enum: a policy account that does not exist fails
//! Anchor's own account check (3012, AccountNotInitialized) before any program code runs.
//! Clients treat 3012 on the `policy` account as PULSO_001_POLICY_NOT_FOUND.

use anchor_lang::prelude::*;

#[error_code]
pub enum PulsoError {
    #[msg("PULSO_001_POLICY_NOT_FOUND")]
    PolicyNotFound,
    #[msg("PULSO_002_POLICY_DISABLED")]
    PolicyDisabled,
    #[msg("PULSO_003_HUMAN_INTENT_REQUIRED")]
    HumanIntentRequired,
    #[msg("PULSO_004_INTENT_EXPIRED")]
    IntentExpired,
    #[msg("PULSO_005_INTENT_ALREADY_USED")]
    IntentAlreadyUsed,
    #[msg("PULSO_006_INTENT_MISMATCH")]
    IntentMismatch,
    #[msg("PULSO_007_RECIPIENT_NOT_ALLOWED")]
    RecipientNotAllowed,
    #[msg("PULSO_008_AMOUNT_EXCEEDS_LIMIT")]
    AmountExceedsLimit,
    #[msg("PULSO_009_DAILY_LIMIT_EXCEEDED")]
    DailyLimitExceeded,
    #[msg("PULSO_010_UNAUTHORIZED_AGENT")]
    UnauthorizedAgent,
    #[msg("PULSO_011_POLICY_CHANGE_FORBIDDEN")]
    PolicyChangeForbidden,
    // Not in the spec's PULSO_001..011 list; appended after them to keep codes stable.
    #[msg("Invalid policy limits")]
    InvalidPolicyLimits,
    #[msg("Invalid intent: expires_at must be in the future and max_uses > 0")]
    InvalidIntent,
    #[msg("Intent revoked")]
    IntentRevoked,
}
