use pulso::error::PulsoError;

/// The 11 spec codes, in spec order. PULSO_00N must be Anchor code 6000 + N - 1.
#[test]
fn spec_error_codes_keep_their_numbers_and_messages() {
    let spec = [
        (PulsoError::PolicyNotFound, "PULSO_001_POLICY_NOT_FOUND"),
        (PulsoError::PolicyDisabled, "PULSO_002_POLICY_DISABLED"),
        (PulsoError::HumanIntentRequired, "PULSO_003_HUMAN_INTENT_REQUIRED"),
        (PulsoError::IntentExpired, "PULSO_004_INTENT_EXPIRED"),
        (PulsoError::IntentAlreadyUsed, "PULSO_005_INTENT_ALREADY_USED"),
        (PulsoError::IntentMismatch, "PULSO_006_INTENT_MISMATCH"),
        (PulsoError::RecipientNotAllowed, "PULSO_007_RECIPIENT_NOT_ALLOWED"),
        (PulsoError::AmountExceedsLimit, "PULSO_008_AMOUNT_EXCEEDS_LIMIT"),
        (PulsoError::DailyLimitExceeded, "PULSO_009_DAILY_LIMIT_EXCEEDED"),
        (PulsoError::UnauthorizedAgent, "PULSO_010_UNAUTHORIZED_AGENT"),
        (PulsoError::PolicyChangeForbidden, "PULSO_011_POLICY_CHANGE_FORBIDDEN"),
    ];
    for (i, (err, message)) in spec.into_iter().enumerate() {
        assert_eq!(err.to_string(), message);
        assert_eq!(u32::from(err), 6000 + i as u32, "{message}");
    }
}

/// Errors outside the spec only ever come after the first 11.
#[test]
fn non_spec_errors_come_after_the_spec() {
    assert_eq!(u32::from(PulsoError::InvalidPolicyLimits), 6011);
    assert_eq!(u32::from(PulsoError::InvalidIntent), 6012);
    assert_eq!(u32::from(PulsoError::IntentRevoked), 6013);
}
