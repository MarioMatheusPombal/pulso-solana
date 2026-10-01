use anchor_lang::{AccountDeserialize, AccountSerialize, Discriminator, Space};
use anchor_lang::prelude::Pubkey;
use litesvm::LiteSVM;
use pulso::{AgentPolicy, POLICY_SEED};

#[test]
fn policy_pda_derivation_and_size() {
    let human = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let (pda, bump) =
        Pubkey::find_program_address(&[POLICY_SEED, human.as_ref(), agent.as_ref()], &pulso::id());
    assert_eq!(POLICY_SEED, b"policy");
    assert_eq!(
        Pubkey::create_program_address(
            &[POLICY_SEED, human.as_ref(), agent.as_ref(), &[bump]],
            &pulso::id()
        )
        .unwrap(),
        pda
    );
    // 32 + 32 + 1 + 8 + 8 + 1 + 8 + 4 + 8 + 8 + 1 + 1
    assert_eq!(AgentPolicy::INIT_SPACE, 112);
    assert_eq!(AgentPolicy::DISCRIMINATOR.len() + AgentPolicy::INIT_SPACE, 120);
}

#[test]
fn policy_initialization_roundtrip() {
    let human = Pubkey::new_unique();
    let agent = Pubkey::new_unique();
    let (pda, bump) =
        Pubkey::find_program_address(&[POLICY_SEED, human.as_ref(), agent.as_ref()], &pulso::id());
    let policy = AgentPolicy {
        human,
        agent,
        enabled: true,
        max_per_transaction: 1_000,
        daily_limit: 5_000,
        require_approval_for_new_recipient: true,
        require_approval_above: 500,
        policy_version: 1,
        spent_in_window: 0,
        window_start: 0,
        bump,
        agent_revoked: false,
    };
    let mut data = Vec::new();
    policy.try_serialize(&mut data).unwrap();
    assert_eq!(data.len(), 8 + AgentPolicy::INIT_SPACE);

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
    let got = AgentPolicy::try_deserialize(&mut stored.data.as_slice()).unwrap();
    assert_eq!(got.human, human);
    assert_eq!(got.agent, agent);
    assert!(got.enabled);
    assert_eq!(got.max_per_transaction, 1_000);
    assert_eq!(got.daily_limit, 5_000);
    assert!(got.require_approval_for_new_recipient);
    assert_eq!(got.require_approval_above, 500);
    assert_eq!(got.policy_version, 1);
    assert_eq!(got.bump, bump);
    assert!(!got.agent_revoked);
}
