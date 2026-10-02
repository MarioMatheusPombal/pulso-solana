#!/usr/bin/env bash
# Deploys or upgrades the PULSO program on devnet. The program ID is fixed, so this needs:
#   - the program keypair at target/deploy/pulso-keypair.json (never committed);
#   - the upgrade-authority wallet from Anchor.toml (~/.config/solana/id.json) with devnet SOL.
# NOT AUDITED · DEVNET DEMONSTRATION ONLY
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

ID="$(solana-keygen pubkey target/deploy/pulso-keypair.json)"
if ! grep -q "declare_id!(\"$ID\")" programs/pulso/src/lib.rs; then
  echo "target/deploy/pulso-keypair.json is $ID, not the ID declared in programs/pulso/src/lib.rs" >&2
  exit 1
fi

anchor build --arch v0
anchor deploy --provider.cluster devnet
solana program show "$ID" --url devnet
