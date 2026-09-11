#!/usr/bin/env bash
# Full validation for dsh-plugin-loomloom.
#
# Runs the three gates in order and stops at the first failure:
#   1. typecheck  — src/ against both tsconfigs
#   2. test       — the node:test suite under tests/
#   3. verify     — the standalone API-surface acceptance runner
#
# Usage (from anywhere):
#   dsh-plugin-loomloom/scripts/run-checks.sh
#
# Exits non-zero when any gate fails.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
cd "$root"

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required (>=22.19.0)" >&2
  exit 1
fi

tsc_bin="$root/node_modules/.bin/tsc"
if [[ ! -x "$tsc_bin" ]]; then
  # Fall back to a hoisted binary when this package was not installed in place.
  tsc_bin="$(command -v tsc || true)"
fi
if [[ -z "$tsc_bin" ]]; then
  echo "error: tsc not found; run the workspace install first" >&2
  exit 1
fi

run_gate() {
  local label="$1"
  shift
  echo
  echo "=== ${label} ==="
  "$@"
}

run_gate "typecheck (tsconfig.json)" "$tsc_bin" -p tsconfig.json --noEmit
run_gate "typecheck (tsconfig.client.json)" "$tsc_bin" -p tsconfig.client.json --noEmit
run_gate "tests" node --import tsx --test 'tests/**/*.spec.ts'
run_gate "api surface verification" node --import tsx scripts/verify-loomloom-apis.ts

echo
echo "All gates passed."
