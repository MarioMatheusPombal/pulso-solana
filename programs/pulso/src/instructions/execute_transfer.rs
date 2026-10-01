use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::{
    action_hash::{compute_action_hash, ActionFields, INSTRUCTION_EXECUTE_TRANSFER},
    constants::*,
    error::PulsoError,
    state::{AgentPolicy, IntentAuthorization, RecipientApproval},
};

/// Daily-limit window: fixed (not sliding), 86_400 s long, measured only by the
/// on-chain `Clock` (never by client time). `window_start` is 0 on creation, so the
/// first spend opens the window at its own `now`. The window covers
/// `[window_start, window_start + WINDOW_SECONDS)`; at `now >= window_start + WINDOW_SECONDS`
/// the counter resets to 0 and `window_start` becomes that `now`.
const WINDOW_SECONDS: i64 = 86_400;

#[derive(Accounts)]
pub struct ExecuteTransfer<'info> {
    pub agent: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.human.as_ref(), policy.agent.as_ref()],
        bump = policy.bump
    )]
    pub policy: Account<'info, AgentPolicy>,
    #[account(
        mut,
        seeds = [VAULT_SEED, policy.key().as_ref()],
        bump
    )]
    pub vault: Account<'info, TokenAccount>,
    #[account(mut, token::mint = vault.mint)]
    pub recipient: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    /// Optional human approval. Typed and program-owned; it is bound to this action by the
    /// recomputed action hash (not by seeds), so tampering returns a PULSO error code.
    #[account(mut)]
    pub intent: Option<Account<'info, IntentAuthorization>>,
    /// Optional allowlist entry for `recipient`, created only by the human via `approve_recipient`.
    #[account(
        seeds = [RECIPIENT_SEED, policy.key().as_ref(), recipient.key().as_ref()],
        bump = recipient_approval.bump
    )]
    pub recipient_approval: Option<Account<'info, RecipientApproval>>,
}

#[event]
pub struct TransferExecuted {
    pub policy: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub spent_in_window: u64,
    pub intent: Option<Pubkey>,
}

/// Emitted right before `HumanIntentRequired` is returned. An Anchor error carries no data,
/// so clients read this from the logs of the failed transaction (or of a simulation) to
/// build the approval request. Pubkeys and numbers only.
#[event]
pub struct IntentRequired {
    pub policy: Pubkey,
    pub human: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub recipient: Pubkey,
    pub amount: u64,
    pub require_approval_above: u64,
    pub policy_version: u32,
}

pub fn handle_execute_transfer(
    ctx: Context<ExecuteTransfer>,
    amount: u64,
    nonce: [u8; 16],
) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    let now = Clock::get()?.unix_timestamp;

    require!(policy.enabled, PulsoError::PolicyDisabled);
    require!(
        ctx.accounts.agent.key() == policy.agent && !policy.agent_revoked,
        PulsoError::UnauthorizedAgent
    );

    if let Some(intent) = ctx.accounts.intent.as_mut() {
        // Approved path: the agent repeats exactly the action the human authorized.
        require!(
            intent.authority == policy.human && intent.agent == policy.agent,
            PulsoError::IntentMismatch
        );
        require!(!intent.revoked, PulsoError::IntentRevoked);
        // Expiry uses only the on-chain clock; valid through `expires_at` inclusive.
        require!(now <= intent.expires_at, PulsoError::IntentExpired);
        require!(intent.used_count < intent.max_uses, PulsoError::IntentAlreadyUsed);
        let expected = compute_action_hash(&ActionFields {
            program_id: crate::ID,
            instruction: INSTRUCTION_EXECUTE_TRANSFER,
            authority: policy.human,
            agent: policy.agent,
            mint: ctx.accounts.vault.mint,
            amount,
            recipient: ctx.accounts.recipient.key(),
            max_uses: intent.max_uses,
            nonce,
            expires_at: intent.expires_at,
        });
        require!(expected == intent.action_hash, PulsoError::IntentMismatch);
        // The per-transaction cap is hard: not even human approval passes it.
        require!(amount <= policy.max_per_transaction, PulsoError::AmountExceedsLimit);
    } else {
        require!(amount <= policy.max_per_transaction, PulsoError::AmountExceedsLimit);
        let new_recipient =
            policy.require_approval_for_new_recipient && ctx.accounts.recipient_approval.is_none();
        if new_recipient || amount > policy.require_approval_above {
            emit!(IntentRequired {
                policy: policy.key(),
                human: policy.human,
                agent: policy.agent,
                mint: ctx.accounts.vault.mint,
                recipient: ctx.accounts.recipient.key(),
                amount,
                require_approval_above: policy.require_approval_above,
                policy_version: policy.policy_version,
            });
            return err!(if new_recipient {
                PulsoError::RecipientNotAllowed
            } else {
                PulsoError::HumanIntentRequired
            });
        }
    }

    if now >= policy.window_start.saturating_add(WINDOW_SECONDS) {
        policy.spent_in_window = 0;
        policy.window_start = now;
    }
    let spent = policy
        .spent_in_window
        .checked_add(amount)
        .ok_or(PulsoError::DailyLimitExceeded)?;
    require!(spent <= policy.daily_limit, PulsoError::DailyLimitExceeded);

    // Consumption is atomic with the transfer: any later failure reverts this increment.
    let intent_key = match ctx.accounts.intent.as_mut() {
        Some(intent) => {
            intent.used_count = intent.used_count.checked_add(1).ok_or(PulsoError::IntentAlreadyUsed)?;
            Some(intent.key())
        }
        None => None,
    };

    // Only the program can sign for the vault: its authority is the policy PDA.
    let human = policy.human;
    let agent = policy.agent;
    let bump = [policy.bump];
    let seeds: &[&[u8]] = &[POLICY_SEED, human.as_ref(), agent.as_ref(), &bump];
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            Transfer {
                from: ctx.accounts.vault.to_account_info(),
                to: ctx.accounts.recipient.to_account_info(),
                authority: policy.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    policy.spent_in_window = spent;
    emit!(TransferExecuted {
        policy: policy.key(),
        agent,
        mint: ctx.accounts.vault.mint,
        recipient: ctx.accounts.recipient.key(),
        amount,
        spent_in_window: spent,
        intent: intent_key,
    });
    Ok(())
}
