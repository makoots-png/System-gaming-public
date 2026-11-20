#!/usr/bin/env bash
# run-all.sh: every architecture check of docs/audit/2026-11-20-arch-check.md, one after another. Changes no file.
#   bash docs/audit/arch-check/run-all.sh
set -e
cd "$(dirname "$0")/../../.."
for c in by-name model-domain types boundary reader-load shared-docs idempotent legacy lessons map-checks demo-by-name demo-rules-bound; do
  echo; echo "################ $c"; bun "docs/audit/arch-check/$c.ts"
done
