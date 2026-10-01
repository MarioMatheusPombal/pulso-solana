//! Account state: pubkeys, hashes, limits, timestamps and status only.

use anchor_lang::prelude::*;

/// Limits that define an agent's autonomy. Seeds: ["policy", human, agent].
#[account]
#[derive(InitSpace)]
pub struct AgentPolicy {
    pub human: Pubkey,
    pub agent: Pubkey,
    pub enabled: bool,
    pub max_per_transaction: u64,
    pub daily_limit: u64,
    pub require_approval_for_new_recipient: bool,
    pub require_approval_above: u64,
    pub policy_version: u32,
    /// Daily-limit counter (used by spend enforcement); kept here to avoid a later account migration.
    pub spent_in_window: u64,
    pub window_start: i64,
    pub bump: u8,
    /// Permanent revocation of the agent; only `revoke_agent` sets it and nothing clears it.
    pub agent_revoked: bool,
}

/// Proof that the human authorized one exact action. Seeds: ["intent", authority, action_hash].
#[account]
#[derive(InitSpace)]
pub struct IntentAuthorization {
    pub authority: Pubkey,
    pub agent: Pubkey,
    pub action_hash: [u8; 32],
    pub issued_at: i64,
    pub expires_at: i64,
    pub max_uses: u16,
    pub used_count: u16,
    pub revoked: bool,
    pub bump: u8,
}

/// Human-approved destination. `recipient` is the destination token account address.
/// Seeds: ["recipient", policy, recipient].
#[account]
#[derive(InitSpace)]
pub struct RecipientApproval {
    pub policy: Pubkey,
    pub recipient: Pubkey,
    pub bump: u8,
}
