use anchor_lang::prelude::*;

use crate::{error::PulsoError, state::IntentAuthorization};

#[derive(Accounts)]
pub struct RevokeIntent<'info> {
    /// Must be the human who issued the intent.
    pub authority: Signer<'info>,
    #[account(
        mut,
        constraint = authority.key() == intent.authority @ PulsoError::PolicyChangeForbidden
    )]
    pub intent: Account<'info, IntentAuthorization>,
}

/// Named `IntentRevocation` because `IntentRevoked` is already the error variant.
#[event]
pub struct IntentRevocation {
    pub intent: Pubkey,
    pub authority: Pubkey,
}

pub fn handle_revoke_intent(ctx: Context<RevokeIntent>) -> Result<()> {
    let intent = &mut ctx.accounts.intent;
    // A fully consumed intent has nothing left to revoke.
    require!(intent.used_count < intent.max_uses, PulsoError::IntentAlreadyUsed);
    intent.revoked = true;

    emit!(IntentRevocation { intent: intent.key(), authority: ctx.accounts.authority.key() });
    Ok(())
}
