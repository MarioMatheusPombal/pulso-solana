use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
        },
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token::{
        self,
        state::{Account as TokenAcc, AccountState, Mint},
    },
    litesvm::LiteSVM,
    pulso::{
        action_hash::{compute_action_hash, ActionFields, INSTRUCTION_EXECUTE_TRANSFER},
        AgentPolicy, IntentAuthorization, PulsoError, INTENT_SEED, POLICY_SEED, RECIPIENT_SEED, VAULT_SEED,
    },
    solana_account::Account,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::{versioned::VersionedTransaction, InstructionError, TransactionError},
};

type Res = Result<litesvm::types::TransactionMetadata, litesvm::types::FailedTransactionMetadata>;

fn send(svm: &mut LiteSVM, ixs: &[Instruction], signers: &[&Keypair]) -> Res {
    let msg = Message::new_with_blockhash(ixs, Some(&signers[0].pubkey()), &svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), signers).unwrap();
    svm.send_transaction(tx)
}

fn custom_code(res: Res) -> u32 {
    match res.unwrap_err().err {
        TransactionError::InstructionError(_, InstructionError::Custom(c)) => c,
        e => panic!("unexpected error: {e:?}"),
    }
}

fn put_mint(svm: &mut LiteSVM, key: Pubkey) {
    let mut data = vec![0u8; Mint::LEN];
    Mint::pack(
        Mint { mint_authority: COption::None, supply: 1_000_000, decimals: 6, is_initialized: true, freeze_authority: COption::None },
        &mut data,
    )
    .unwrap();
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner: spl_token::id(), executable: false, rent_epoch: 0 }).unwrap();
}

fn token_acc(svm: &mut LiteSVM, key: Pubkey, mint: Pubkey, owner: Pubkey, amount: u64) {
    let mut data = vec![0u8; TokenAcc::LEN];
    TokenAcc::pack(
        TokenAcc { mint, owner, amount, delegate: COption::None, state: AccountState::Initialized, is_native: COption::None, delegated_amount: 0, close_authority: COption::None },
        &mut data,
    )
    .unwrap();
    svm.set_account(key, Account { lamports: 1_000_000_000, data, owner: spl_token::id(), executable: false, rent_epoch: 0 }).unwrap();
}

fn balance(svm: &LiteSVM, key: &Pubkey) -> u64 {
    TokenAcc::unpack(&svm.get_account(key).unwrap().data).unwrap().amount
}

struct Env {
    svm: LiteSVM,
    human: Keypair,
    agent: Keypair,
    mint: Pubkey,
    policy: Pubkey,
    vault: Pubkey,
}

/// Policy created; vault not yet created.
fn setup() -> Env {
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(env!("CARGO_TARGET_TMPDIR"), "/../deploy/pulso.so"));
    svm.add_program(pulso::id(), bytes).unwrap();
    let human = Keypair::new();
    let agent = Keypair::new();
    svm.airdrop(&human.pubkey(), 10_000_000_000).unwrap();
    svm.airdrop(&agent.pubkey(), 1_000_000_000).unwrap();
    let mint = Pubkey::new_unique();
    put_mint(&mut svm, mint);
    let (policy, _) = Pubkey::find_program_address(
        &[POLICY_SEED, human.pubkey().as_ref(), agent.pubkey().as_ref()],
        &pulso::id(),
    );
    let (vault, _) = Pubkey::find_program_address(&[VAULT_SEED, policy.as_ref()], &pulso::id());
    let create_policy = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreatePolicy {
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: false,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::CreatePolicy { human: human.pubkey(), agent: agent.pubkey(), policy, system_program: system_program::ID }
            .to_account_metas(None),
    );
    send(&mut svm, &[create_policy], &[&human]).unwrap();
    Env { svm, human, agent, mint, policy, vault }
}

fn vault_ix(env: &Env, human: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreateVault {}.data(),
        pulso::accounts::CreateVault {
            human,
            policy: env.policy,
            mint: env.mint,
            vault: env.vault,
            token_program: spl_token::id(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    )
}

fn transfer_ix(env: &Env, agent: Pubkey, recipient: Pubkey, amount: u64) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::ExecuteTransfer { amount, nonce: [0; 16] }.data(),
        pulso::accounts::ExecuteTransfer {
            agent,
            policy: env.policy,
            vault: env.vault,
            recipient,
            token_program: spl_token::id(),
            intent: None,
            recipient_approval: None,
        }
        .to_account_metas(None),
    )
}

fn spent(env: &Env) -> u64 {
    let acc = env.svm.get_account(&env.policy).unwrap();
    AgentPolicy::try_deserialize(&mut acc.data.as_slice()).unwrap().spent_in_window
}

/// Policy (max 1_000, daily 5_000, approval above 500), funded vault, empty recipient.
fn env_with_recipient() -> (Env, Pubkey) {
    let mut env = setup();
    let ix = vault_ix(&env, env.human.pubkey());
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    token_acc(&mut env.svm, env.vault, env.mint, env.policy, 10_000);
    let recipient = Pubkey::new_unique();
    token_acc(&mut env.svm, recipient, env.mint, Pubkey::new_unique(), 0);
    (env, recipient)
}

fn run(env: &mut Env, recipient: Pubkey, amount: u64) -> Res {
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    let ix = transfer_ix(env, agent.pubkey(), recipient, amount);
    send(&mut env.svm, &[ix], &[&agent])
}

fn assert_rejected(env: &mut Env, recipient: Pubkey, amount: u64, error: PulsoError) {
    assert_eq!(custom_code(run(env, recipient, amount)), error as u32 + 6000);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn agent_transfers_below_limit_and_counter_accumulates() {
    let (mut env, recipient) = env_with_recipient();
    let meta = run(&mut env, recipient, 400).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    assert_eq!(balance(&env.svm, &env.vault), 9_600);
    assert_eq!(balance(&env.svm, &recipient), 400);
    assert_eq!(spent(&env), 400);

    run(&mut env, recipient, 300).unwrap();
    assert_eq!(balance(&env.svm, &env.vault), 9_300);
    assert_eq!(balance(&env.svm, &recipient), 700);
    assert_eq!(spent(&env), 700);
}

#[test]
fn unrevoked_policy_can_be_paused_and_resumed() {
    let (mut env, recipient) = env_with_recipient();
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::UpdatePolicy {
            enabled: false,
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: false,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::UpdatePolicy { authority: env.human.pubkey(), policy: env.policy }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    assert_rejected(&mut env, recipient, 100, PulsoError::PolicyDisabled);
    assert_eq!(spent(&env), 0);

    let account = env.svm.get_account(&env.policy).unwrap();
    let paused = AgentPolicy::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert!(!paused.enabled);
    assert!(!paused.agent_revoked);

    update_limits(&mut env, 1_000, 5_000, 500);
    let account = env.svm.get_account(&env.policy).unwrap();
    let resumed = AgentPolicy::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert!(resumed.enabled);
    assert!(!resumed.agent_revoked);

    run(&mut env, recipient, 100).unwrap();
    assert_eq!(spent(&env), 100);
    assert_eq!(balance(&env.svm, &env.vault), 9_900);
    assert_eq!(balance(&env.svm, &recipient), 100);
}

#[test]
fn wrong_agent_rejected() {
    let (mut env, recipient) = env_with_recipient();
    let other = Keypair::new();
    env.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    let ix = transfer_ix(&env, other.pubkey(), recipient, 100);
    let res = send(&mut env.svm, &[ix], &[&other]);
    assert_eq!(custom_code(res), PulsoError::UnauthorizedAgent as u32 + 6000);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
}

#[test]
fn amount_above_max_per_transaction_rejected() {
    let (mut env, recipient) = env_with_recipient();
    assert_rejected(&mut env, recipient, 1_001, PulsoError::AmountExceedsLimit);
}

#[test]
fn amount_above_approval_threshold_requires_human_intent() {
    let (mut env, recipient) = env_with_recipient();
    assert_rejected(&mut env, recipient, 501, PulsoError::HumanIntentRequired);
}

#[test]
fn daily_limit_exceeded_rejected() {
    let (mut env, recipient) = env_with_recipient();
    for _ in 0..10 {
        run(&mut env, recipient, 500).unwrap(); // reaches the 5_000 daily limit
    }
    assert_eq!(spent(&env), 5_000);
    assert_eq!(custom_code(run(&mut env, recipient, 1)), PulsoError::DailyLimitExceeded as u32 + 6000);
    assert_eq!(balance(&env.svm, &env.vault), 5_000);
    assert_eq!(balance(&env.svm, &recipient), 5_000);
}

fn update_limits(env: &mut Env, max: u64, daily: u64, above: u64) {
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::UpdatePolicy {
            enabled: true,
            max_per_transaction: max,
            daily_limit: daily,
            require_approval_for_new_recipient: false,
            require_approval_above: above,
        }
        .data(),
        pulso::accounts::UpdatePolicy { authority: env.human.pubkey(), policy: env.policy }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
}

#[test]
fn amount_exactly_at_max_per_transaction_passes_and_one_above_fails() {
    let (mut env, recipient) = env_with_recipient();
    update_limits(&mut env, 1_000, 5_000, 1_000);
    assert_rejected(&mut env, recipient, 1_001, PulsoError::AmountExceedsLimit);
    run(&mut env, recipient, 1_000).unwrap();
    assert_eq!(balance(&env.svm, &recipient), 1_000);
    assert_eq!(spent(&env), 1_000);
}

#[test]
fn per_transaction_and_daily_errors_are_distinct() {
    let (mut env, recipient) = env_with_recipient();
    update_limits(&mut env, 1_000, 2_000, 1_000);
    let per_tx = custom_code(run(&mut env, recipient, 1_001));
    run(&mut env, recipient, 1_000).unwrap();
    run(&mut env, recipient, 1_000).unwrap(); // daily limit reached
    let daily = custom_code(run(&mut env, recipient, 1));
    assert_eq!(per_tx, PulsoError::AmountExceedsLimit as u32 + 6000);
    assert_eq!(daily, PulsoError::DailyLimitExceeded as u32 + 6000);
    assert_ne!(per_tx, daily);
}

fn set_time(env: &mut Env, ts: i64) {
    let mut clock = env.svm.get_sysvar::<anchor_lang::prelude::Clock>();
    clock.unix_timestamp = ts;
    env.svm.set_sysvar(&clock);
}

fn window_start(env: &Env) -> i64 {
    let acc = env.svm.get_account(&env.policy).unwrap();
    AgentPolicy::try_deserialize(&mut acc.data.as_slice()).unwrap().window_start
}

#[test]
fn daily_window_rolls_over_exactly_at_86400_seconds() {
    let (mut env, recipient) = env_with_recipient();
    let t0 = 1_000_000;
    set_time(&mut env, t0);
    for _ in 0..10 {
        run(&mut env, recipient, 500).unwrap(); // reaches the 5_000 daily limit
    }
    assert_eq!(window_start(&env), t0);
    let exceeded = PulsoError::DailyLimitExceeded as u32 + 6000;
    assert_eq!(custom_code(run(&mut env, recipient, 1)), exceeded);

    // One second before the rollover the window is still the same.
    set_time(&mut env, t0 + 86_399);
    assert_eq!(custom_code(run(&mut env, recipient, 1)), exceeded);
    assert_eq!(spent(&env), 5_000);

    // Exactly at the rollover the counter resets and the new window starts at `now`.
    set_time(&mut env, t0 + 86_400);
    run(&mut env, recipient, 300).unwrap();
    assert_eq!(spent(&env), 300);
    assert_eq!(window_start(&env), t0 + 86_400);
    assert_eq!(balance(&env.svm, &recipient), 5_300);
}

/// Decodes the first `IntentRequired` event found in the logs, if any.
fn intent_required_event(logs: &[String]) -> Option<pulso::IntentRequired> {
    use anchor_lang::{AnchorDeserialize, Discriminator};
    use base64::Engine;
    logs.iter().filter_map(|l| l.strip_prefix("Program data: ")).find_map(|b64| {
        let raw = base64::engine::general_purpose::STANDARD.decode(b64).ok()?;
        let body = raw.strip_prefix(pulso::IntentRequired::DISCRIMINATOR)?;
        pulso::IntentRequired::try_from_slice(body).ok()
    })
}

#[test]
fn human_intent_required_emits_event_with_approval_request_data() {
    let (mut env, recipient) = env_with_recipient();
    let err = run(&mut env, recipient, 501).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(0, InstructionError::Custom(PulsoError::HumanIntentRequired as u32 + 6000))
    );
    let ev = intent_required_event(&err.meta.logs).expect("IntentRequired event missing from failed tx logs");
    assert_eq!(ev.policy, env.policy);
    assert_eq!(ev.human, env.human.pubkey());
    assert_eq!(ev.agent, env.agent.pubkey());
    assert_eq!(ev.mint, env.mint);
    assert_eq!(ev.recipient, recipient);
    assert_eq!(ev.amount, 501);
    assert_eq!(ev.require_approval_above, 500);
    assert_eq!(ev.policy_version, 1);
}

#[test]
fn disabled_policy_above_threshold_returns_disabled_without_event() {
    let (mut env, recipient) = env_with_recipient();
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::UpdatePolicy {
            enabled: false,
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: false,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::UpdatePolicy { authority: env.human.pubkey(), policy: env.policy }.to_account_metas(None),
    );
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    let err = run(&mut env, recipient, 501).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(0, InstructionError::Custom(PulsoError::PolicyDisabled as u32 + 6000))
    );
    assert!(intent_required_event(&err.meta.logs).is_none());
}

// ---------------------------------------------------------------------------
// Approved path: execute_transfer with a human intent (issue #99).
// ---------------------------------------------------------------------------

const T0: i64 = 1_000_000;
const NONCE: [u8; 16] = [9; 16];

/// The action the human approves, with the hash fields it is computed from.
struct Approved {
    amount: u64,
    recipient: Pubkey,
    mint: Pubkey,
    nonce: [u8; 16],
    max_uses: u16,
    expires_at: i64,
}

fn hash_of(env: &Env, a: &Approved) -> [u8; 32] {
    compute_action_hash(&ActionFields {
        program_id: pulso::id(),
        instruction: INSTRUCTION_EXECUTE_TRANSFER,
        authority: env.human.pubkey(),
        agent: env.agent.pubkey(),
        mint: a.mint,
        amount: a.amount,
        recipient: a.recipient,
        max_uses: a.max_uses,
        nonce: a.nonce,
        expires_at: a.expires_at,
    })
}

fn intent_pda(env: &Env, hash: &[u8; 32]) -> Pubkey {
    Pubkey::find_program_address(&[INTENT_SEED, env.human.pubkey().as_ref(), hash], &pulso::id()).0
}

/// The human records an intent for `hash`; returns its PDA.
fn record(env: &mut Env, hash: [u8; 32], expires_at: i64, max_uses: u16) -> Pubkey {
    let intent = intent_pda(env, &hash);
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::RecordIntent { action_hash: hash, expires_at, max_uses }.data(),
        pulso::accounts::RecordIntent {
            authority: env.human.pubkey(),
            policy: env.policy,
            intent,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    env.svm.expire_blockhash();
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    intent
}

/// Human approves `a` exactly (hash of the exact action); returns the intent PDA.
fn approve(env: &mut Env, a: &Approved) -> Pubkey {
    let hash = hash_of(env, a);
    record(env, hash, a.expires_at, a.max_uses)
}

fn run_with_intent(env: &mut Env, intent: Pubkey, recipient: Pubkey, amount: u64, nonce: [u8; 16]) -> Res {
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    let mut ix = transfer_ix(env, agent.pubkey(), recipient, amount);
    ix.data = pulso::instruction::ExecuteTransfer { amount, nonce }.data();
    ix.accounts = pulso::accounts::ExecuteTransfer {
        agent: agent.pubkey(),
        policy: env.policy,
        vault: env.vault,
        recipient,
        token_program: spl_token::id(),
        intent: Some(intent),
        recipient_approval: None,
    }
    .to_account_metas(None);
    send(&mut env.svm, &[ix], &[&agent])
}

fn used_count(env: &Env, intent: &Pubkey) -> u16 {
    let acc = env.svm.get_account(intent).unwrap();
    IntentAuthorization::try_deserialize(&mut acc.data.as_slice()).unwrap().used_count
}

fn approved(env: &Env, recipient: Pubkey, amount: u64, max_uses: u16) -> Approved {
    Approved { amount, recipient, mint: env.mint, nonce: NONCE, max_uses, expires_at: T0 + 600 }
}

#[test]
fn approved_action_above_threshold_executes_and_consumes_intent() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    // Scenario B: without an intent, 700 (> 500 threshold) needs human approval.
    assert_rejected(&mut env, recipient, 700, PulsoError::HumanIntentRequired);

    let a = approved(&env, recipient, 700, 1);
    let intent = approve(&mut env, &a);
    assert_eq!(used_count(&env, &intent), 0);

    let meta = run_with_intent(&mut env, intent, recipient, 700, NONCE).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &env.vault), 9_300);
    assert_eq!(balance(&env.svm, &recipient), 700);
    assert_eq!(spent(&env), 700); // approved spending counts toward the daily limit
}

#[test]
fn reusing_a_single_use_intent_fails_and_balance_is_unchanged() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    let a = approved(&env, recipient, 700, 1);
    let intent = approve(&mut env, &a);
    run_with_intent(&mut env, intent, recipient, 700, NONCE).unwrap();

    // Scenario E: replay of the same approved action.
    let code = custom_code(run_with_intent(&mut env, intent, recipient, 700, NONCE));
    assert_eq!(code, PulsoError::IntentAlreadyUsed as u32 + 6000);
    assert_eq!(code, 6004);
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &env.vault), 9_300);
    assert_eq!(balance(&env.svm, &recipient), 700);
}

#[test]
fn max_uses_two_allows_two_executions_and_blocks_the_third() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    let a = approved(&env, recipient, 600, 2);
    let intent = approve(&mut env, &a);
    run_with_intent(&mut env, intent, recipient, 600, NONCE).unwrap();
    run_with_intent(&mut env, intent, recipient, 600, NONCE).unwrap();
    assert_eq!(used_count(&env, &intent), 2);
    assert_eq!(balance(&env.svm, &recipient), 1_200);

    let code = custom_code(run_with_intent(&mut env, intent, recipient, 600, NONCE));
    assert_eq!(code, PulsoError::IntentAlreadyUsed as u32 + 6000);
    assert_eq!(used_count(&env, &intent), 2);
    assert_eq!(balance(&env.svm, &env.vault), 8_800);
    assert_eq!(balance(&env.svm, &recipient), 1_200);
}

#[test]
fn two_identical_transactions_in_sequence_only_one_passes() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    let a = approved(&env, recipient, 700, 1);
    let intent = approve(&mut env, &a);
    // Two byte-identical transactions (same blockhash), submitted back to back.
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    let mut ix = transfer_ix(&env, agent.pubkey(), recipient, 700);
    ix.data = pulso::instruction::ExecuteTransfer { amount: 700, nonce: NONCE }.data();
    ix.accounts = pulso::accounts::ExecuteTransfer {
        agent: agent.pubkey(),
        policy: env.policy,
        vault: env.vault,
        recipient,
        token_program: spl_token::id(),
        intent: Some(intent),
        recipient_approval: None,
    }
    .to_account_metas(None);
    let msg = Message::new_with_blockhash(&[ix], Some(&agent.pubkey()), &env.svm.latest_blockhash());
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&agent]).unwrap();
    let results = [env.svm.send_transaction(tx.clone()), env.svm.send_transaction(tx)];
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &env.vault), 9_300);
    assert_eq!(balance(&env.svm, &recipient), 700);
}

// ---------------------------------------------------------------------------
// Intent expiry (issue #100): on-chain Clock only; valid through `expires_at` inclusive.
// ---------------------------------------------------------------------------

#[test]
fn intent_valid_at_expires_at_and_expired_one_second_later() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    let a = approved(&env, recipient, 700, 2);
    let intent = approve(&mut env, &a);

    // now == expires_at: still valid.
    set_time(&mut env, a.expires_at);
    run_with_intent(&mut env, intent, recipient, 700, NONCE).unwrap();
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &recipient), 700);
    let vault_after_valid = balance(&env.svm, &env.vault);
    let recipient_after_valid = balance(&env.svm, &recipient);
    let spent_after_valid = spent(&env);
    let used_after_valid = used_count(&env, &intent);

    // Scenario F: now == expires_at + 1 (uses remain, but the approval is stale).
    set_time(&mut env, a.expires_at + 1);
    let code = custom_code(run_with_intent(&mut env, intent, recipient, 700, NONCE));
    assert_eq!(code, PulsoError::IntentExpired as u32 + 6000);
    assert_eq!(code, 6003);
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &env.vault), 9_300);
    assert_eq!(balance(&env.svm, &recipient), 700);
    assert_eq!(balance(&env.svm, &env.vault), vault_after_valid);
    assert_eq!(balance(&env.svm, &recipient), recipient_after_valid);
    assert_eq!(spent(&env), spent_after_valid);
    assert_eq!(used_count(&env, &intent), used_after_valid);
    println!(
        "PULSO_LITESVM_SCENARIO_F code={code} expires_at={} clock={} vault={} recipient={} spent={} used_count={}",
        a.expires_at,
        a.expires_at + 1,
        balance(&env.svm, &env.vault),
        balance(&env.svm, &recipient),
        spent(&env),
        used_count(&env, &intent),
    );
}

// ---------------------------------------------------------------------------
// Intent mismatch (issue #101): anything that differs from the approved action
// is IntentMismatch (6005), with balances and used_count untouched.
// ---------------------------------------------------------------------------

/// Env where 100 needs approval; the human approved exactly 100 to `recipient`.
fn approved_100() -> (Env, Pubkey, Pubkey, Approved) {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    update_limits(&mut env, 1_000, 5_000, 50);
    let a = approved(&env, recipient, 100, 1);
    let intent = approve(&mut env, &a);
    (env, recipient, intent, a)
}

fn assert_mismatch_untouched(env: &mut Env, intent: Pubkey, recipient: Pubkey, amount: u64, nonce: [u8; 16]) {
    let code = custom_code(run_with_intent(env, intent, recipient, amount, nonce));
    assert_eq!(code, PulsoError::IntentMismatch as u32 + 6000);
    assert_eq!(code, 6005);
    assert_eq!(used_count(env, &intent), 0);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(spent(env), 0);
}

#[test]
fn approved_exact_action_executes() {
    let (mut env, recipient, intent, _) = approved_100();
    run_with_intent(&mut env, intent, recipient, 100, NONCE).unwrap();
    assert_eq!(used_count(&env, &intent), 1);
    assert_eq!(balance(&env.svm, &recipient), 100);
}

#[test]
fn different_amount_is_mismatch() {
    // Scenario C: approved 100, the agent tries 150.
    let (mut env, recipient, intent, _) = approved_100();
    assert_mismatch_untouched(&mut env, intent, recipient, 150, NONCE);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn different_recipient_is_mismatch() {
    // Scenario D: same amount, another destination account of the same mint.
    let (mut env, recipient, intent, _) = approved_100();
    let other = Pubkey::new_unique();
    token_acc(&mut env.svm, other, env.mint, Pubkey::new_unique(), 0);
    assert_mismatch_untouched(&mut env, intent, other, 100, NONCE);
    assert_eq!(balance(&env.svm, &other), 0);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn intent_hashed_with_another_mint_is_mismatch() {
    let (mut env, recipient) = env_with_recipient();
    set_time(&mut env, T0);
    update_limits(&mut env, 1_000, 5_000, 50);
    let mut a = approved(&env, recipient, 100, 1);
    a.mint = Pubkey::new_unique();
    let intent = approve(&mut env, &a);
    assert_mismatch_untouched(&mut env, intent, recipient, 100, NONCE);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn different_nonce_is_mismatch() {
    let (mut env, recipient, intent, _) = approved_100();
    assert_mismatch_untouched(&mut env, intent, recipient, 100, [8; 16]);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn intent_from_another_policy_is_mismatch() {
    let (mut env, recipient, _, a) = approved_100();
    // A second human creates a policy for the same agent and records an intent there.
    let human2 = Keypair::new();
    env.svm.airdrop(&human2.pubkey(), 10_000_000_000).unwrap();
    let (policy2, _) = Pubkey::find_program_address(
        &[POLICY_SEED, human2.pubkey().as_ref(), env.agent.pubkey().as_ref()],
        &pulso::id(),
    );
    let create = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreatePolicy {
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: false,
            require_approval_above: 50,
        }
        .data(),
        pulso::accounts::CreatePolicy { human: human2.pubkey(), agent: env.agent.pubkey(), policy: policy2, system_program: system_program::ID }
            .to_account_metas(None),
    );
    // Same fields as `a`, but hashed for human2: even a "perfect" copy belongs to another policy.
    let hash2 = compute_action_hash(&ActionFields {
        program_id: pulso::id(),
        instruction: INSTRUCTION_EXECUTE_TRANSFER,
        authority: human2.pubkey(),
        agent: env.agent.pubkey(),
        mint: a.mint,
        amount: a.amount,
        recipient,
        max_uses: a.max_uses,
        nonce: a.nonce,
        expires_at: a.expires_at,
    });
    let intent2 = Pubkey::find_program_address(&[INTENT_SEED, human2.pubkey().as_ref(), &hash2], &pulso::id()).0;
    let record2 = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::RecordIntent { action_hash: hash2, expires_at: a.expires_at, max_uses: 1 }.data(),
        pulso::accounts::RecordIntent { authority: human2.pubkey(), policy: policy2, intent: intent2, system_program: system_program::ID }
            .to_account_metas(None),
    );
    send(&mut env.svm, &[create, record2], &[&human2]).unwrap();

    assert_mismatch_untouched(&mut env, intent2, recipient, 100, NONCE);
    assert_eq!(used_count(&env, &intent2), 0);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

// ---------------------------------------------------------------------------
// Revocation (issue #102): revoke_intent and revoke_agent.
// ---------------------------------------------------------------------------

fn revoke_intent_ix(authority: Pubkey, intent: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::RevokeIntent {}.data(),
        pulso::accounts::RevokeIntent { authority, intent }.to_account_metas(None),
    )
}

fn revoke_agent_ix(authority: Pubkey, policy: Pubkey) -> Instruction {
    Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::RevokeAgent {}.data(),
        pulso::accounts::RevokeAgent { authority, policy }.to_account_metas(None),
    )
}

fn is_revoked(env: &Env, intent: &Pubkey) -> bool {
    let acc = env.svm.get_account(intent).unwrap();
    IntentAuthorization::try_deserialize(&mut acc.data.as_slice()).unwrap().revoked
}

#[test]
fn human_revokes_intent_and_agent_gets_revoked_error_not_expired() {
    let (mut env, recipient, intent, _) = approved_100();
    let human = env.human.insecure_clone();
    env.svm.expire_blockhash();
    let meta = send(&mut env.svm, &[revoke_intent_ix(human.pubkey(), intent)], &[&human]).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    assert!(is_revoked(&env, &intent));

    // End to end: the agent tries the exact approved action and gets 6013, not 6003.
    let code = custom_code(run_with_intent(&mut env, intent, recipient, 100, NONCE));
    assert_eq!(code, PulsoError::IntentRevoked as u32 + 6000);
    assert_eq!(code, 6013);
    assert_ne!(code, PulsoError::IntentExpired as u32 + 6000);
    assert_eq!(used_count(&env, &intent), 0);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn only_the_authority_can_revoke_an_intent() {
    let (mut env, _recipient, intent, _) = approved_100();
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    let res = send(&mut env.svm, &[revoke_intent_ix(agent.pubkey(), intent)], &[&agent]);
    assert_eq!(custom_code(res), 6010);
    assert!(!is_revoked(&env, &intent));
}

#[test]
fn fully_consumed_intent_cannot_be_revoked() {
    let (mut env, recipient, intent, _) = approved_100();
    run_with_intent(&mut env, intent, recipient, 100, NONCE).unwrap();
    let human = env.human.insecure_clone();
    env.svm.expire_blockhash();
    let res = send(&mut env.svm, &[revoke_intent_ix(human.pubkey(), intent)], &[&human]);
    assert_eq!(custom_code(res), 6004);
    assert!(!is_revoked(&env, &intent));
}

fn agent_revoked(env: &Env) -> bool {
    let acc = env.svm.get_account(&env.policy).unwrap();
    AgentPolicy::try_deserialize(&mut acc.data.as_slice()).unwrap().agent_revoked
}

#[test]
fn revoked_agent_is_unauthorized_on_both_paths() {
    let (mut env, recipient, intent, _) = approved_100();
    let human = env.human.insecure_clone();
    env.svm.expire_blockhash();
    let meta = send(&mut env.svm, &[revoke_agent_ix(human.pubkey(), env.policy)], &[&human]).unwrap();
    assert!(meta.logs.iter().any(|l| l.starts_with("Program data:")), "event not emitted");
    assert!(agent_revoked(&env));

    // Autonomous path (below the threshold of 50 would pass; 40 does).
    assert_eq!(custom_code(run(&mut env, recipient, 40)), 6009);
    // Approved path with a perfectly valid intent.
    assert_eq!(custom_code(run_with_intent(&mut env, intent, recipient, 100, NONCE)), 6009);
    assert_eq!(used_count(&env, &intent), 0);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

#[test]
fn agent_revocation_is_permanent_and_only_the_human_can_do_it() {
    let (mut env, recipient, intent, _) = approved_100();
    assert_eq!(used_count(&env, &intent), 0);

    // The agent cannot revoke itself.
    let agent = env.agent.insecure_clone();
    let res = send(&mut env.svm, &[revoke_agent_ix(agent.pubkey(), env.policy)], &[&agent]);
    assert_eq!(custom_code(res), 6010);
    assert!(!agent_revoked(&env));

    let human = env.human.insecure_clone();
    env.svm.expire_blockhash();
    send(&mut env.svm, &[revoke_agent_ix(human.pubkey(), env.policy)], &[&human]).unwrap();
    // update_policy (even re-enabling) does not undo the revocation.
    update_limits(&mut env, 1_000, 5_000, 500);
    assert!(agent_revoked(&env));
    let account = env.svm.get_account(&env.policy).unwrap();
    let policy = AgentPolicy::try_deserialize(&mut account.data.as_slice()).unwrap();
    assert!(policy.enabled);

    assert_eq!(custom_code(run(&mut env, recipient, 40)), 6009);
    assert_eq!(custom_code(run_with_intent(&mut env, intent, recipient, 100, NONCE)), 6009);
    assert_eq!(used_count(&env, &intent), 0);
    assert_eq!(spent(&env), 0);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);
}

// ---- new-recipient approval (allowlist) ----

fn set_new_recipient_flag(env: &mut Env, on: bool) {
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::UpdatePolicy {
            enabled: true,
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: on,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::UpdatePolicy { authority: env.human.pubkey(), policy: env.policy }.to_account_metas(None),
    );
    env.svm.expire_blockhash();
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
}

fn approval_pda(env: &Env, recipient: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[RECIPIENT_SEED, env.policy.as_ref(), recipient.as_ref()], &pulso::id()).0
}

fn approve_recipient(env: &mut Env, signer: &Keypair, recipient: Pubkey) -> Res {
    let ix = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::ApproveRecipient {}.data(),
        pulso::accounts::ApproveRecipient {
            human: signer.pubkey(),
            policy: env.policy,
            recipient,
            recipient_approval: approval_pda(env, &recipient),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    env.svm.expire_blockhash();
    send(&mut env.svm, &[ix], &[signer])
}

fn run_allowlisted(env: &mut Env, recipient: Pubkey, amount: u64) -> Res {
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    let mut ix = transfer_ix(env, agent.pubkey(), recipient, amount);
    ix.accounts = pulso::accounts::ExecuteTransfer {
        agent: agent.pubkey(),
        policy: env.policy,
        vault: env.vault,
        recipient,
        token_program: spl_token::id(),
        intent: None,
        recipient_approval: Some(approval_pda(env, &recipient)),
    }
    .to_account_metas(None);
    send(&mut env.svm, &[ix], &[&agent])
}

#[test]
fn new_recipient_below_threshold_requires_approval_then_passes_after_approve_recipient() {
    let (mut env, recipient) = env_with_recipient();
    set_new_recipient_flag(&mut env, true);
    let err = run(&mut env, recipient, 100).unwrap_err();
    assert_eq!(
        err.err,
        TransactionError::InstructionError(0, InstructionError::Custom(PulsoError::RecipientNotAllowed as u32 + 6000))
    );
    let ev = intent_required_event(&err.meta.logs).expect("IntentRequired event missing");
    assert_eq!(ev.recipient, recipient);
    assert_eq!(ev.amount, 100);
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);

    let human = env.human.insecure_clone();
    approve_recipient(&mut env, &human, recipient).unwrap();
    run_allowlisted(&mut env, recipient, 100).unwrap();
    assert_eq!(balance(&env.svm, &recipient), 100);
    // Allowlisted recipients still obey the approval threshold.
    let res = run_allowlisted(&mut env, recipient, 501);
    assert_eq!(custom_code(res), PulsoError::HumanIntentRequired as u32 + 6000);
}

#[test]
fn flag_off_new_recipient_passes_without_approval() {
    let (mut env, recipient) = env_with_recipient();
    set_new_recipient_flag(&mut env, false);
    run(&mut env, recipient, 100).unwrap();
    assert_eq!(balance(&env.svm, &recipient), 100);
}

#[test]
fn flag_on_new_recipient_with_valid_intent_passes_without_allowlisting() {
    let (mut env, recipient) = env_with_recipient();
    set_new_recipient_flag(&mut env, true);
    set_time(&mut env, T0);
    let a = approved(&env, recipient, 100, 1);
    let intent = approve(&mut env, &a);
    run_with_intent(&mut env, intent, recipient, 100, NONCE).unwrap();
    assert_eq!(balance(&env.svm, &recipient), 100);
    // Executing with an intent does not add the recipient to the allowlist.
    assert_eq!(custom_code(run(&mut env, recipient, 100)), PulsoError::RecipientNotAllowed as u32 + 6000);
}

#[test]
fn only_the_human_can_approve_a_recipient() {
    let (mut env, recipient) = env_with_recipient();
    let agent = env.agent.insecure_clone();
    assert_eq!(
        custom_code(approve_recipient(&mut env, &agent, recipient)),
        PulsoError::PolicyChangeForbidden as u32 + 6000
    );
    assert!(env.svm.get_account(&approval_pda(&env, &recipient)).is_none());
}

#[test]
fn agent_owned_policy_cannot_access_human_vault() {
    let (mut env, recipient) = env_with_recipient();
    let (agent_policy, _) = Pubkey::find_program_address(
        &[
            POLICY_SEED,
            env.agent.pubkey().as_ref(),
            env.agent.pubkey().as_ref(),
        ],
        &pulso::id(),
    );
    let create_agent_policy = Instruction::new_with_bytes(
        pulso::id(),
        &pulso::instruction::CreatePolicy {
            max_per_transaction: 1_000,
            daily_limit: 5_000,
            require_approval_for_new_recipient: false,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::CreatePolicy {
            human: env.agent.pubkey(),
            agent: env.agent.pubkey(),
            policy: agent_policy,
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );
    let agent = env.agent.insecure_clone();
    env.svm.expire_blockhash();
    send(&mut env.svm, &[create_agent_policy], &[&agent]).unwrap();

    let human_policy_before = env.svm.get_account(&env.policy).unwrap();
    let human_policy_before =
        AgentPolicy::try_deserialize(&mut human_policy_before.data.as_slice()).unwrap();
    let agent_policy_before = env.svm.get_account(&agent_policy).unwrap();
    let agent_policy_before =
        AgentPolicy::try_deserialize(&mut agent_policy_before.data.as_slice()).unwrap();

    let mut ix = transfer_ix(&env, agent.pubkey(), recipient, 100);
    assert_eq!(ix.accounts[1].pubkey, env.policy);
    ix.accounts[1].pubkey = agent_policy;
    env.svm.expire_blockhash();
    assert_eq!(
        custom_code(send(&mut env.svm, &[ix], &[&agent])),
        anchor_lang::error::ErrorCode::ConstraintSeeds as u32,
    );

    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &recipient), 0);
    let human_policy_after = env.svm.get_account(&env.policy).unwrap();
    let human_policy_after =
        AgentPolicy::try_deserialize(&mut human_policy_after.data.as_slice()).unwrap();
    assert_eq!(human_policy_after.policy_version, human_policy_before.policy_version);
    assert_eq!(
        human_policy_after.spent_in_window,
        human_policy_before.spent_in_window
    );
    assert_eq!(human_policy_after.enabled, human_policy_before.enabled);
    let agent_policy_after = env.svm.get_account(&agent_policy).unwrap();
    let agent_policy_after = AgentPolicy::try_deserialize(&mut agent_policy_after.data.as_slice()).unwrap();
    assert_eq!(agent_policy_after.policy_version, agent_policy_before.policy_version);
    assert_eq!(
        agent_policy_after.spent_in_window,
        agent_policy_before.spent_in_window
    );
}
