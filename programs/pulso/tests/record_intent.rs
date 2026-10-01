use {
    anchor_lang::{
        prelude::{Clock, Pubkey},
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    pulso::{IntentAuthorization, PulsoError, INTENT_SEED, POLICY_SEED},
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::{versioned::VersionedTransaction, InstructionError, TransactionError},
};

const NOW: i64 = 1_000_000;
const HASH: [u8; 32] = [7; 32];

fn send(
    svm: &mut LiteSVM,
    ix: Instruction,
    signer: &Keypair,
) -> Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata> {
    let msg = Message::new_with_blockhash(&[ix], Some(&signer.pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[signer]).unwrap();
    svm.send_transaction(tx)
}

fn custom_code(
    res: Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>,
) -> u32 {
    match res.unwrap_err().err {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) => c,
        e => panic!("unexpected error: {e:?}"),
    }
}

fn intent_pda(authority: &Pubkey, hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[INTENT_SEED, authority.as_ref(), hash], &pulso::id()).0
}

fn record_ix(
    authority: Pubkey,
    policy: Pubkey,
    hash: [u8; 32],
    expires_at: i64,
    max_uses: u16,
) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::RecordIntent { action_hash: hash, expires_at, max_uses }.data(),
        pulso::accounts::RecordIntent {
            authority,
            policy,
            intent: intent_pda(&authority, &hash),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn read(svm: &LiteSVM, key: &Pubkey) -> IntentAuthorization {
    IntentAuthorization::try_deserialize(&mut svm.get_account(key).unwrap().data.as_slice()).unwrap()
}

fn setup() -> (LiteSVM, Keypair, Keypair, Pubkey) {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pulso.so"));
    svm.add_program(pulso::id(), bytes).unwrap();
    let mut clock = svm.get_sysvar::<Clock>();
    clock.unix_timestamp = NOW;
    svm.set_sysvar(&clock);
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
fn human_records_intent() {
    let (mut svm, human, agent, policy) = setup();
    let meta = send(&mut svm, record_ix(human.pubkey(), policy, HASH, NOW + 600, 2), &human).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    let pda = intent_pda(&human.pubkey(), &HASH);
    let i = read(&svm, &pda);
    assert_eq!(i.authority, human.pubkey());
    assert_eq!(i.agent, agent.pubkey());
    assert_eq!(i.action_hash, HASH);
    assert_eq!(i.issued_at, NOW);
    assert_eq!(i.expires_at, NOW + 600);
    assert_eq!((i.max_uses, i.used_count, i.revoked), (2, 0, false));
    assert_eq!(i.bump, Pubkey::find_program_address(&[INTENT_SEED, human.pubkey().as_ref(), &HASH], &pulso::id()).1);
}

#[test]
fn non_human_cannot_record_intent() {
    let (mut svm, human, agent, policy) = setup();
    // Agent signs as authority: the intent PDA is derived from the agent's key.
    let res = send(&mut svm, record_ix(agent.pubkey(), policy, HASH, NOW + 600, 1), &agent);
    assert_eq!(custom_code(res), 6010);
    assert_eq!(PulsoError::PolicyChangeForbidden as u32 + 6000, 6010);
    assert!(svm.get_account(&intent_pda(&agent.pubkey(), &HASH)).is_none());
    assert!(svm.get_account(&intent_pda(&human.pubkey(), &HASH)).is_none());
}

#[test]
fn rejects_past_or_current_expiry_and_zero_uses() {
    let (mut svm, human, _agent, policy) = setup();
    let invalid = PulsoError::InvalidIntent as u32 + 6000;
    for (exp, uses) in [(NOW - 1, 1), (NOW, 1), (NOW + 600, 0)] {
        svm.expire_blockhash();
        let res = send(&mut svm, record_ix(human.pubkey(), policy, HASH, exp, uses), &human);
        assert_eq!(custom_code(res), invalid);
        assert!(svm.get_account(&intent_pda(&human.pubkey(), &HASH)).is_none());
    }
}

#[test]
fn duplicate_intent_rejected_and_state_intact() {
    let (mut svm, human, _agent, policy) = setup();
    send(&mut svm, record_ix(human.pubkey(), policy, HASH, NOW + 600, 2), &human).unwrap();
    let pda = intent_pda(&human.pubkey(), &HASH);
    let before = svm.get_account(&pda).unwrap().data;
    svm.expire_blockhash();
    assert!(send(&mut svm, record_ix(human.pubkey(), policy, HASH, NOW + 9_999, 9), &human).is_err());
    assert_eq!(svm.get_account(&pda).unwrap().data, before);
}
