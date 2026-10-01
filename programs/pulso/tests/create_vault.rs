use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{
            instruction::Instruction, program_option::COption, program_pack::Pack, system_program,
        },
        InstructionData, ToAccountMetas,
    },
    anchor_spl::token::spl_token::{
        self,
        state::{Account as TokenAcc, AccountState, Mint},
    },
    litesvm::LiteSVM,
    pulso::{PulsoError, POLICY_SEED, VAULT_SEED},
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
            require_approval_for_new_recipient: true,
            require_approval_above: 500,
        }
        .data(),
        pulso::accounts::CreatePolicy { human: human.pubkey(), agent: agent.pubkey(), policy, system_program: system_program::ID }
            .to_account_metas(None),
    );
    send(&mut svm, &[create_policy], &[&human]).unwrap();
    Env { svm, human, agent, mint, policy, vault }
}

/// Creates the vault through the program, then funds it. Funding is a plain SPL
/// balance change, so the test writes the balance directly.
fn setup_funded() -> Env {
    let mut env = setup();
    let ix = vault_ix(&env, env.human.pubkey());
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    token_acc(&mut env.svm, env.vault, env.mint, env.policy, 10_000);
    env
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

#[test]
fn vault_has_correct_mint_and_program_controlled_authority() {
    let mut env = setup();
    let ix = vault_ix(&env, env.human.pubkey());
    send(&mut env.svm, &[ix], &[&env.human.insecure_clone()]).unwrap();
    let v = TokenAcc::unpack(&env.svm.get_account(&env.vault).unwrap().data).unwrap();
    assert_eq!(v.mint, env.mint);
    assert_eq!(v.owner, env.policy);
}

#[test]
fn only_the_policy_human_can_create_a_vault() {
    let mut env = setup();
    let other = Keypair::new();
    env.svm.airdrop(&other.pubkey(), 1_000_000_000).unwrap();
    let ix = vault_ix(&env, other.pubkey());
    let res = send(&mut env.svm, &[ix], &[&other]);
    assert_eq!(custom_code(res), PulsoError::PolicyChangeForbidden as u32 + 6000);
    assert!(env.svm.get_account(&env.vault).is_none());
}

/// Transfer from the vault signed by `signer` pretending to be its authority.
fn direct_transfer(env: &mut Env, signer: &Keypair, dest: Pubkey) -> Res {
    let mut ix = spl_token::instruction::transfer(&spl_token::id(), &env.vault, &dest, &env.policy, &[], 100).unwrap();
    // The policy PDA cannot sign; mark the would-be authority as the attacker's key.
    ix.accounts[2].pubkey = signer.pubkey();
    send(&mut env.svm, &[ix], &[signer])
}

#[test]
fn agent_cannot_transfer_from_vault_directly() {
    let mut env = setup_funded();
    let dest = Pubkey::new_unique();
    token_acc(&mut env.svm, dest, env.mint, env.agent.pubkey(), 0);
    let agent = env.agent.insecure_clone();
    assert!(direct_transfer(&mut env, &agent, dest).is_err());
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &dest), 0);
}

#[test]
fn human_cannot_transfer_from_vault_directly() {
    let mut env = setup_funded();
    let dest = Pubkey::new_unique();
    token_acc(&mut env.svm, dest, env.mint, env.human.pubkey(), 0);
    let human = env.human.insecure_clone();
    assert!(direct_transfer(&mut env, &human, dest).is_err());
    assert_eq!(balance(&env.svm, &env.vault), 10_000);
    assert_eq!(balance(&env.svm, &dest), 0);
}
