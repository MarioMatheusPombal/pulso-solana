//! One file per instruction, re-exported here.

pub mod approve_recipient;
pub mod create_policy;
pub mod create_vault;
pub mod execute_transfer;
pub mod record_intent;
pub mod revoke_agent;
pub mod revoke_intent;
pub mod update_policy;

pub use approve_recipient::*;
pub use create_policy::*;
pub use create_vault::*;
pub use execute_transfer::*;
pub use record_intent::*;
pub use revoke_agent::*;
pub use revoke_intent::*;
pub use update_policy::*;
