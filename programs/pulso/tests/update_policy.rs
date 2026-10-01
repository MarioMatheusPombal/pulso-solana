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
    solana_transaction::{versioned::VersionedTransaction, InstructionError, TransactionError},
};

fn send(
    svm: &mut LiteSVM,
    ix: Instruction,
    signer: &Keypair,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
}

fn update_ix(authority: Pubkey, policy: Pubkey, max_tx: u64, daily: u64, above: u64) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::UpdatePolicy {
            enabled: false,
            max_per_transaction: max_tx,
            daily_limit: daily,
            require_approval_for_new_recipient: false,
            require_approval_above: above,
        }
        .data(),
        pulso::accounts::UpdatePolicy { authority, policy }.to_account_metas(None),
    )
}

fn read(svm: &LiteSVM, policy: &Pubkey) -> AgentPolicy {
    AgentPolicy::try_deserialize(&mut svm.get_account(policy).unwrap().data.as_slice()).unwrap()
}

fn custom_code(
    res: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>,
) -> u32 {
    match res.unwrap_err().err {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) => c,
        e => panic!("unexpected error: {e:?}"),
    }
}

/// Human creates a policy (1_000 / 5_000 / 500) for `agent`.
fn setup() -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pulso.so"));
    svm.add_program(pulso::id(), bytes).unwrap();
    let human = Keypair::new();
    let agent = Keypair::new();
    for k in [&human, &agent] {
        svm.airdrop(&k.pubkey(), 1_000_000_000).unwrap();
    }
    let (policy, _) = Pubkey::find_program_address(
        &[POLICY_SEED, human.pubkey().as_ref(), agent.pubkey().as_ref()],
        &pulso::id(),
    );
    let create = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreatePolicy {
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: true,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::CreatePolicy {
            human: human.pubkey(),
            agent: agent.pubkey(),
            policy,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    send(&mut svm, create, &human).unwrap();
    (svm, human, agent, policy)
}

#[test]
fn human_updates_and_version_increments() {
    let (mut svm, human, _agent, policy) = setup();
    let before = read(&svm, &policy);
    let meta = send(&mut svm, update_ix(human.pubkey(), policy, 2_000, 9_000, 800), &human).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    let p = read(&svm, &policy);
    assert_eq!(p.policy_version, 2);
    assert!(!p.enabled);
    assert_eq!(p.max_per_transaction, 2_000);
    assert_eq!(p.daily_limit, 9_000);
    assert!(!p.require_approval_for_new_recipient);
    assert_eq!(p.require_approval_above, 800);
    assert_eq!((p.human, p.agent, p.bump), (before.human, before.agent, before.bump));
    assert_eq!((p.spent_in_window, p.window_start), (0, 0));

    svm.expire_blockhash();
    send(&mut svm, update_ix(human.pubkey(), policy, 2_000, 9_000, 800), &human).unwrap();
    assert_eq!(read(&svm, &policy).policy_version, 3);
}

#[test]
fn agent_cannot_raise_own_limit() {
    let (mut svm, _human, agent, policy) = setup();
    let before = read(&svm, &policy);
    let res = send(&mut svm, update_ix(agent.pubkey(), policy, 1_000_000, 9_000_000, 0), &agent);
    assert_eq!(custom_code(res), 6010);
    assert_eq!(PulsoError::PolicyChangeForbidden as u32 + 6000, 6010);
    let after = read(&svm, &policy);
    assert_eq!(after.max_per_transaction, before.max_per_transaction);
    assert_eq!(after.daily_limit, before.daily_limit);
    assert_eq!(after.enabled, before.enabled);
    assert_eq!(after.policy_version, 1);
}

#[test]
fn third_party_cannot_update() {
    let (mut svm, _human, _agent, policy) = setup();
    let stranger = Keypair::new();
    svm.airdrop(&stranger.pubkey(), 1_000_000_000).unwrap();
    let res = send(&mut svm, update_ix(stranger.pubkey(), policy, 1_000_000, 9_000_000, 0), &stranger);
    assert_eq!(custom_code(res), 6010);
    assert_eq!(read(&svm, &policy).policy_version, 1);
}

#[test]
fn incoherent_limits_rejected_on_update() {
    let (mut svm, human, _agent, policy) = setup();
    let res = send(&mut svm, update_ix(human.pubkey(), policy, 6_000, 5_000, 0), &human);
    assert_eq!(custom_code(res), PulsoError::InvalidPolicyLimits as u32 + 6000);
    assert_eq!(read(&svm, &policy).policy_version, 1);
}
