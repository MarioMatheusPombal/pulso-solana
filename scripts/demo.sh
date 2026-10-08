#!/usr/bin/env bash
# Bootstrap and full A–G demo. Machine dependencies: pnpm, Anchor, Solana CLI and Cargo.
# Pass --scenario C to run a single scenario; with no arguments it runs all of them in sequence.
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
