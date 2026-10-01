//! Canonical action hash, v1. PUBLIC PROTOCOL INTERFACE: the TypeScript SDK
//! reimplements this byte for byte. Shared vectors: `tests/vectors/action_hash.json`.
//!
//! hash = SHA-256 of the concatenation, in this order, of fixed-size fields
//! (no separators, no JSON, no length prefixes):
//!
//! | field       | size | encoding                                              |
//! |-------------|------|-------------------------------------------------------|
//! | domain      | 15   | ASCII `PULSO_INTENT_V1` (version + domain)            |
//! | chain       | 6    | ASCII `solana`                                        |
//! | program_id  | 32   | raw pubkey bytes                                      |
//! | instruction | 1    | `1` = execute_transfer (SPL transfer)                 |
//! | authority   | 32   | raw pubkey bytes (the human)                          |
//! | agent       | 32   | raw pubkey bytes                                      |
//! | mint        | 32   | raw pubkey bytes                                      |
//! | amount      | 8    | u64 little-endian                                     |
//! | recipient   | 32   | raw pubkey bytes (destination token account address)  |
//! | max_uses    | 2    | u16 little-endian (constraints)                       |
//! | nonce       | 16   | raw bytes                                             |
//! | expires_at  | 8    | i64 little-endian                                     |
//!
//! Total preimage: 216 bytes.

use {anchor_lang::prelude::Pubkey, solana_sha256_hasher::hashv};

pub const DOMAIN: &[u8; 15] = b"PULSO_INTENT_V1";
pub const CHAIN: &[u8; 6] = b"solana";
/// `instruction` value for execute_transfer.
pub const INSTRUCTION_EXECUTE_TRANSFER: u8 = 1;
pub const PREIMAGE_LEN: usize = 216;

/// All fields bound by the hash (everything after the fixed domain and chain).
pub struct ActionFields {
    pub program_id: Pubkey,
    pub instruction: u8,
    pub authority: Pubkey,
    pub agent: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
    pub recipient: Pubkey,
    pub max_uses: u16,
    pub nonce: [u8; 16],
    pub expires_at: i64,
}

/// Pure function: same fields always give the same 32 bytes.
pub fn compute_action_hash(f: &ActionFields) -> [u8; 32] {
    hashv(&[
        &DOMAIN[..],
        &CHAIN[..],
        f.program_id.as_ref(),
        &[f.instruction],
        f.authority.as_ref(),
        f.agent.as_ref(),
        f.mint.as_ref(),
        &f.amount.to_le_bytes(),
        f.recipient.as_ref(),
        &f.max_uses.to_le_bytes(),
        &f.nonce,
        &f.expires_at.to_le_bytes(),
    ])
    .to_bytes()
}
