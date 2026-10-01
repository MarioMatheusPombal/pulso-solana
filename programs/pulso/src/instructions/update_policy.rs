use anchor_lang::prelude::*;

use super::create_policy::validate_limits;
use crate::{constants::*, error::PulsoError, state::AgentPolicy};

#[derive(Accounts)]
pub struct UpdatePolicy<'info> {
    /// Must be the policy's human. The agent can never change its own policy.
    pub authority: Signer<'info>,
    #[account(
        mut,
        seeds = [POLICY_SEED, policy.human.as_ref(), policy.agent.as_ref()],
        bump = policy.bump,
        constraint = authority.key() == policy.human @ PulsoError::PolicyChangeForbidden
    )]
    pub policy: Account<'info, AgentPolicy>,
}

#[event]
pub struct PolicyUpdated {
    pub policy: Pubkey,
    pub human: Pubkey,
    pub agent: Pubkey,
    pub enabled: bool,
    pub max_per_transaction: u64,
    pub daily_limit: u64,
    pub require_approval_for_new_recipient: bool,
    pub require_approval_above: u64,
    pub policy_version: u32,
}

pub fn handle_update_policy(
    ctx: Context<UpdatePolicy>,
    enabled: bool,
    max_per_transaction: u64,
    daily_limit: u64,
    require_approval_for_new_recipient: bool,
    require_approval_above: u64,
) -> Result<()> {
    validate_limits(max_per_transaction, daily_limit, require_approval_above)?;

    let policy = &mut ctx.accounts.policy;
    policy.enabled = enabled;
    policy.max_per_transaction = max_per_transaction;
    policy.daily_limit = daily_limit;
    policy.require_approval_for_new_recipient = require_approval_for_new_recipient;
    policy.require_approval_above = require_approval_above;
    policy.policy_version = policy
        .policy_version
        .checked_add(1)
        .ok_or(ProgramError::ArithmeticOverflow)?;

    emit!(PolicyUpdated {
        policy: policy.key(),
        human: policy.human,
        agent: policy.agent,
        enabled,
        max_per_transaction,
        daily_limit,
        require_approval_for_new_recipient,
        require_approval_above,
        policy_version: policy.policy_version,
    });
    Ok(())
}
