#!/usr/bin/env bash
# Concatenate the migrations not yet confirmed on production
# (PENDING_MIGRATIONS.md) so they can be pasted into the Supabase SQL editor:
#
#   ./scripts/print-pending-sql.sh | pbcopy
#
# 0036 (realtime.messages) was applied & verified 2026-08-27 and is no longer
# here. This prints 0037-0039 (plain public-schema DDL).
set -euo pipefail
cd "$(dirname "$0")/.."

for m in 0037 0038 0039; do
  f=$(ls supabase/migrations/${m}_*.sql 2>/dev/null | head -1) || true
  [ -n "${f:-}" ] || continue
  echo "-- ===================================================================="
  echo "-- $f"
  echo "-- ===================================================================="
  cat "$f"
  echo
done
