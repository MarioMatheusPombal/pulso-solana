use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::{
    constants::*,
    error::PulsoError,
    state::{AgentPolicy, RecipientApproval},
};

#[derive(Accounts)]
pub struct ApproveRecipient<'info> {
    /// Must be the policy's human; the agent can never allowlist a destination itself.
    #[account(mut)]
    pub human: Signer<'info>,
    #[account(
        seeds = [POLICY_SEED, policy.human.as_ref(), policy.agent.as_ref()],
        bump = policy.bump,
        constraint = human.key() == policy.human @ PulsoError::PolicyChangeForbidden
    )]
    pub policy: Account<'info, AgentPolicy>,
    /// Destination token account being allowlisted (read only).
    pub recipient: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = human,
        space = 8 + RecipientApproval::INIT_SPACE,
        seeds = [RECIPIENT_SEED, policy.key().as_ref(), recipient.key().as_ref()],
        bump
    )]
    pub recipient_approval: Account<'info, RecipientApproval>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct RecipientApproved {
    pub policy: Pubkey,
    pub recipient: Pubkey,
}

pub fn handle_approve_recipient(ctx: Context<ApproveRecipient>) -> Result<()> {
    let approval = &mut ctx.accounts.recipient_approval;
    approval.policy = ctx.accounts.policy.key();
    approval.recipient = ctx.accounts.recipient.key();
    approval.bump = ctx.bumps.recipient_approval;

    emit!(RecipientApproved { policy: approval.policy, recipient: approval.recipient });
    Ok(())
}
