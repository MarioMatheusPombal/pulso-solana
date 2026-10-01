use anchor_lang::prelude::*;

use crate::{constants::*, error::PulsoError, state::AgentPolicy};

#[derive(Accounts)]
pub struct RevokeAgent<'info> {
    /// Must be the policy's human. The agent can never revoke or un-revoke itself.
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
pub struct AgentRevoked {
    pub policy: Pubkey,
    pub human: Pubkey,
    pub agent: Pubkey,
}

/// Permanent: `update_policy` never clears `agent_revoked` (unlike `enabled`, which is a pause).
pub fn handle_revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
    let policy = &mut ctx.accounts.policy;
    policy.agent_revoked = true;

    emit!(AgentRevoked { policy: policy.key(), human: policy.human, agent: policy.agent });
    Ok(())
}
