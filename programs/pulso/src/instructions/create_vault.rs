use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{constants::*, error::PulsoError, state::AgentPolicy};

#[derive(Accounts)]
pub struct CreateVault<'info> {
    /// Must be the policy's human; pays for the vault account.
    #[account(mut)]
    pub human: Signer<'info>,
    #[account(
        seeds = [POLICY_SEED, policy.human.as_ref(), policy.agent.as_ref()],
        bump = policy.bump,
        constraint = human.key() == policy.human @ PulsoError::PolicyChangeForbidden
    )]
    pub policy: Account<'info, AgentPolicy>,
    pub mint: Account<'info, Mint>,
    /// Token account whose authority is the policy PDA: only this program can
    /// sign for it, so funds move only through instructions that check policy.
    #[account(
        init,
        payer = human,
        seeds = [VAULT_SEED, policy.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = policy,
    )]
    pub vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_vault(_ctx: Context<CreateVault>) -> Result<()> {
    Ok(())
}
