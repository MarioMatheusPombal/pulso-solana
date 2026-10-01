use anchor_lang::prelude::*;

use crate::{constants::*, error::PulsoError, state::AgentPolicy};

#[derive(Accounts)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub human: Signer<'info>,
    /// CHECK: only its pubkey is stored and used as a PDA seed; the agent does not sign.
    pub agent: UncheckedAccount<'info>,
    #[account(
        init,
        payer = human,
        space = 8 + AgentPolicy::INIT_SPACE,
        seeds = [POLICY_SEED, human.key().as_ref(), agent.key().as_ref()],
        bump
    )]
    pub policy: Account<'info, AgentPolicy>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct PolicyCreated {
    pub policy: Pubkey,
    pub human: Pubkey,
    pub agent: Pubkey,
    pub max_per_transaction: u64,
    pub daily_limit: u64,
    pub require_approval_for_new_recipient: bool,
    pub require_approval_above: u64,
    pub policy_version: u32,
}

pub(crate) fn validate_limits(
    max_per_transaction: u64,
    daily_limit: u64,
    require_approval_above: u64,
) -> Result<()> {
    require!(
        max_per_transaction <= daily_limit && require_approval_above <= max_per_transaction,
        PulsoError::InvalidPolicyLimits
    );
    Ok(())
}

pub fn handle_create_policy(
    ctx: Context<CreatePolicy>,
    max_per_transaction: u64,
    daily_limit: u64,
    require_approval_for_new_recipient: bool,
    require_approval_above: u64,
) -> Result<()> {
    validate_limits(max_per_transaction, daily_limit, require_approval_above)?;

    let policy = &mut ctx.accounts.policy;
    policy.human = ctx.accounts.human.key();
    policy.agent = ctx.accounts.agent.key();
    policy.enabled = true;
    policy.max_per_transaction = max_per_transaction;
    policy.daily_limit = daily_limit;
    policy.require_approval_for_new_recipient = require_approval_for_new_recipient;
    policy.require_approval_above = require_approval_above;
    policy.policy_version = 1;
    policy.spent_in_window = 0;
    policy.window_start = 0;
    policy.bump = ctx.bumps.policy;
    policy.agent_revoked = false;

    emit!(PolicyCreated {
        policy: policy.key(),
        human: policy.human,
        agent: policy.agent,
        max_per_transaction,
        daily_limit,
        require_approval_for_new_recipient,
        require_approval_above,
        policy_version: 1,
    });
    Ok(())
}
