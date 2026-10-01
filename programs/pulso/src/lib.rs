//! PULSO: programmable human authorization for autonomous agents.
//!
//! NOT AUDITED. DEVNET DEMONSTRATION ONLY.

pub mod action_hash;
pub mod constants;
pub mod error;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;

pub use constants::*;
pub use instructions::*;
pub use error::*;
pub use state::*;

declare_id!("4jdHys9YsHTbVQxB6YAr7R8jsmoEy7wqcpxC9tk2dqQi");

#[program]
pub mod pulso {
    use super::*;

    pub fn create_policy(
        ctx: Context<CreatePolicy>,
        max_per_transaction: u64,
        daily_limit: u64,
        require_approval_for_new_recipient: bool,
        require_approval_above: u64,
    ) -> Result<()> {
        instructions::create_policy::handle_create_policy(
            ctx,
            max_per_transaction,
            daily_limit,
            require_approval_for_new_recipient,
            require_approval_above,
        )
    }

    pub fn update_policy(
        ctx: Context<UpdatePolicy>,
        enabled: bool,
        max_per_transaction: u64,
        daily_limit: u64,
        require_approval_for_new_recipient: bool,
        require_approval_above: u64,
    ) -> Result<()> {
        instructions::update_policy::handle_update_policy(
            ctx,
            enabled,
            max_per_transaction,
            daily_limit,
            require_approval_for_new_recipient,
            require_approval_above,
        )
    }

    pub fn create_vault(ctx: Context<CreateVault>) -> Result<()> {
        instructions::create_vault::handle_create_vault(ctx)
    }

    pub fn execute_transfer(ctx: Context<ExecuteTransfer>,
        amount: u64,
        nonce: [u8; 16],
    ) -> Result<()> {
        instructions::execute_transfer::handle_execute_transfer(ctx, amount, nonce)
    }

    pub fn record_intent(
        ctx: Context<RecordIntent>,
        action_hash: [u8; 32],
        expires_at: i64,
        max_uses: u16,
    ) -> Result<()> {
        instructions::record_intent::handle_record_intent(ctx, action_hash, expires_at, max_uses)
    }

    pub fn revoke_intent(ctx: Context<RevokeIntent>) -> Result<()> {
        instructions::revoke_intent::handle_revoke_intent(ctx)
    }

    pub fn revoke_agent(ctx: Context<RevokeAgent>) -> Result<()> {
        instructions::revoke_agent::handle_revoke_agent(ctx)
    }

    pub fn approve_recipient(ctx: Context<ApproveRecipient>) -> Result<()> {
        instructions::approve_recipient::handle_approve_recipient(ctx)
    }
}
