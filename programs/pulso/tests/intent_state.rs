use anchor_lang::prelude::Pubkey;
use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator, Space};
use litesvm::LiteSVM;
use pulso::{IntentAuthorization, INTENT_SEED};

#[test]
fn intent_pda_derivation_and_size() {
    let authority = Pubkey::new_unique();
    let action_hash = [7u8; 32];
    let (pda, bump) =
        Pubkey::find_program_address(&[INTENT_SEED, authority.as_ref(), &action_hash], &pulso::id());
    assert_eq!(INTENT_SEED, b"intent");
    assert_eq!(
        Pubkey::create_program_address(
            &[INTENT_SEED, authority.as_ref(), &action_hash, &[bump]],
            &pulso::id()
        )
        .unwrap(),
        pda
    );
    // 32 + 32 + 32 + 8 + 8 + 2 + 2 + 1 + 1
    assert_eq!(IntentAuthorization::INIT_SPACE, 118);
    assert_eq!(IntentAuthorization::DISCRIMINATOR.len() + IntentAuthorization::INIT_SPACE, 126);
}

#[test]
fn intent_initialization_roundtrip() {
    let authority = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let action_hash = [7u8; 32];
    let (pda, bump) =
        Pubkey::find_program_address(&[INTENT_SEED, authority.as_ref(), &action_hash], &pulso::id());
    let intent = IntentAuthorization {
        authority,
        agent,
        action_hash,
        issued_at: 100,
        expires_at: 200,
        max_uses: 1,
        used_count: 0,
        revoked: false,
        bump,
    };
    let mut data = Vec::new();
    intent.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), 8 + IntentAuthorization::INIT_SPACE);

    let mut svm = LiteSVM::new();
    svm.set_account(
        pda,
        solana_account::Account {
            lamports: 1_000_000_000,
            data,
            owner: pulso::id(),
            executable: false,
            rent_epoch: 0,
        },
    )
    .unwrap();

    let stored = svm.get_account(&pda).unwrap();
    let got = IntentAuthorization::try_deserialize(&mut stored.data.as_slice()).unwrap();
    assert_eq!(got.authority, authority);
    assert_eq!(got.agent, agent);
    assert_eq!(got.action_hash, action_hash);
    assert_eq!(got.issued_at, 100);
    assert_eq!(got.expires_at, 200);
    assert_eq!(got.max_uses, 1);
    assert_eq!(got.used_count, 0);
    assert!(!got.revoked);
    assert_eq!(got.bump, bump);
}
