use anchor_lang::prelude::*;

use crate::{
    constants::*,
    error::PulsoError,
    state::{AgentPolicy, IntentAuthorization},
};

#[derive(Accounts)]
#[instruction(action_hash: [u8; 32])]
pub struct RecordIntent<'info> {
    /// Must be the policy's human; pays for the intent account.
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(
        seeds = [POLICY_SEED, policy.human.as_ref(), policy.agent.as_ref()],
        bump = policy.bump,
        constraint = authority.key() == policy.human @ PulsoError::PolicyChangeForbidden
    )]
    pub policy: Account<'info, AgentPolicy>,
    /// One intent per (authority, action_hash): `init` rejects duplicates.
    #[account(
        init,
        payer = authority,
        space = 8 + IntentAuthorization::INIT_SPACE,
        seeds = [INTENT_SEED, authority.key().as_ref(), action_hash.as_ref()],
        bump
    )]
    pub intent: Account<'info, IntentAuthorization>,
    pub system_program: Program<'info, System>,
}

#[event]
pub struct IntentRecorded {
    pub intent: Pubkey,
    pub policy: Pubkey,
    pub authority: Pubkey,
    pub agent: Pubkey,
    pub action_hash: [u8; 32],
    pub expires_at: i64,
    pub max_uses: u16,
}

/// The program does not recompute the hash: the human signs the hash the UI built
/// from the exact payload shown. It is checked against the real action at execution.
pub fn handle_record_intent(
    ctx: Context<RecordIntent>,
    action_hash: [u8; 32],
    expires_at: i64,
    max_uses: u16,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    require!(expires_at > now && max_uses > 0, PulsoError::InvalidIntent);

    let intent = &mut ctx.accounts.intent;
    intent.authority = ctx.accounts.authority.key();
    intent.agent = ctx.accounts.policy.agent;
    intent.action_hash = action_hash;
    intent.issued_at = now;
    intent.expires_at = expires_at;
    intent.max_uses = max_uses;
    intent.used_count = 0;
    intent.revoked = false;
    intent.bump = ctx.bumps.intent;

    emit!(IntentRecorded {
        intent: intent.key(),
        policy: ctx.accounts.policy.key(),
        authority: intent.authority,
        agent: intent.agent,
        action_hash,
        expires_at,
        max_uses,
    });
    Ok(())
}
