#!/usr/bin/env bash
# Cria mint de teste, policy, vault e contas da demo (idempotente). Uso: scripts/setup-demo.sh [localnet|devnet]
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec pnpm --filter @pulso/agent-demo run setup -- --cluster "${1:-localnet}"
