#!/usr/bin/env bash
#
# Guard against stale generated API code.
#
# lib/api-client-react/src/generated/* and lib/api-zod/src/* are GENERATED from
# lib/api-spec/openapi.yaml by orval, but their output is committed to git. If
# the spec gains an endpoint and nobody re-runs codegen + commits the result,
# the committed files drift from the spec and the next deploy fails with a
# cryptic "No matching export" error (this happened with getVersion /
# listActiveRoster). This script catches that drift early: it regenerates, then
# fails if the working tree changed.
#
# Run:  pnpm run verify:codegen
set -euo pipefail

cd "$(dirname "$0")/.."

GENERATED_PATHS=(
  "lib/api-zod/src/generated"
  "lib/api-zod/src/index.ts"
  "lib/api-client-react/src/generated"
)

echo "→ Regenerating API client + zod schemas from openapi.yaml…"
pnpm --filter @workspace/api-spec run codegen

echo "→ Checking generated output for drift…"
DIRTY="$(git status --porcelain -- "${GENERATED_PATHS[@]}")"
if [ -n "$DIRTY" ]; then
  echo ""
  echo "✗ Generated API code is STALE — it does not match lib/api-spec/openapi.yaml."
  echo "  Fix: run  pnpm --filter @workspace/api-spec run codegen  and commit the result."
  echo ""
  echo "  Drift in:"
  echo "$DIRTY"
  exit 1
fi

echo "✓ Generated API code is in sync with the spec."
