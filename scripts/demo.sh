#!/usr/bin/env bash
# Bootstrap e demo completa A–F. Dependências de máquina: pnpm, Anchor, Solana CLI e Cargo.
# Passe --scenario C para rodar um cenário isolado; sem argumentos roda todos em sequência.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

for command in pnpm anchor cargo solana-test-validator; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "missing required command: $command" >&2
    exit 127
  fi
done

echo "[demo] installing locked workspace dependencies"
pnpm install --frozen-lockfile
echo "[demo] building PULSO for SBF v0 (required by LiteSVM)"
pnpm build

if [ "$#" -eq 0 ]; then
  set -- --all
fi

exec pnpm --filter @pulso/agent-demo demo -- "$@"
