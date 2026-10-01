use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    pulso::{AgentPolicy, PulsoError, POLICY_SEED},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

fn setup() -> (LiteSVM, Keypair, Pubkey, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pulso.so"));
    svm.add_program(pulso::id(), bytes).unwrap();
    let human = Keypair::new();
    svm.airdrop(&human.pubkey(), 1_000_000_000).unwrap();
    let agent = Pubkey::new_unique();
    let (policy, _) = Pubkey::find_program_address(
        &[POLICY_SEED, human.pubkey().as_ref(), agent.as_ref()],
        &pulso::id(),
    );
    (svm, human, agent, policy)
}

fn ix(human: Pubkey, agent: Pubkey, policy: Pubkey, max_tx: u64, daily: u64, above: u64) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreatePolicy {
            max_per_transaction: max_tx,
            daily_limit: daily,
            require_approval_for_new_recipient: true,
            require_approval_above: above,
        }
        .data(),
        pulso::accounts::CreatePolicy { human, agent, policy, system_program: system_program::ID }
            .to_account_metas(None),
    )
}

fn custom_code(
    res: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>,
) -> u32 {
    use solana_transaction::{InstructionError, TransactionError};
    match res.unwrap_err().err {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) => c,
        e => panic!("unexpected error: {e:?}"),
    }
}

#[test]
fn human_creates_policy() {
    let (mut svm, human, agent, policy) = setup();
    let i = ix(human.pubkey(), agent, policy, 1_000, 5_000, 500);
    let msg = Message::new_with_blockhash(&[i], Some(&human.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&human]).unwrap();
    let meta = svm.send_transaction(tx).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");

    let acc = svm.get_account(&policy).unwrap();
    let p = AgentPolicy::try_deserialize(&mut acc.data.as_slice()).unwrap();
    assert_eq!(p.human, human.pubkey());
    assert_eq!(p.agent, agent);
    assert!(p.enabled);
    assert_eq!(p.max_per_transaction, 1_000);
    assert_eq!(p.daily_limit, 5_000);
    assert!(p.require_approval_for_new_recipient);
    assert_eq!(p.require_approval_above, 500);
    assert_eq!(p.policy_version, 1);
    assert_eq!(p.spent_in_window, 0);
    assert_eq!(p.window_start, 0);
}

#[test]
fn incoherent_limits_rejected() {
    let expected = PulsoError::InvalidPolicyLimits as u32 + 6000;
    // max_per_transaction > daily_limit, then require_approval_above > max_per_transaction
    for (max_tx, daily, above) in [(6_000, 5_000, 0), (1_000, 5_000, 1_001)] {
        let (mut svm, human, agent, policy) = setup();
        let i = ix(human.pubkey(), agent, policy, max_tx, daily, above);
        let msg = Message::new_with_blockhash(&[i], Some(&human.pubkey()), &svm.latest_blockhash());
        let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&human]).unwrap();
        assert_eq!(custom_code(svm.send_transaction(tx)), expected);
        assert!(svm.get_account(&policy).is_none());
    }
}

#[test]
fn agent_cannot_create_policy_for_human_without_signature() {
    let (mut svm, human, _, _) = setup();
    let agent = Keypair::new();
    svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();
    let (policy, _) = Pubkey::find_program_address(
        &[POLICY_SEED, human.pubkey().as_ref(), agent.pubkey().as_ref()],
        &pulso::id(),
    );
    let mut i = ix(
        human.pubkey(),
        agent.pubkey(),
        policy,
        1_000,
        5_000,
        500,
    );
    i.accounts[0].is_signer = false; // the agent pays, but the human does not sign
    let msg = Message::new_with_blockhash(&[i], Some(&agent.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&agent]).unwrap();
    assert_eq!(
        custom_code(svm.send_transaction(tx)),
        anchor_lang::error::ErrorCode::AccountNotSigner as u32,
    );
    assert!(svm.get_account(&policy).is_none());
}
