#!/usr/bin/env bash
# Verifier-only: approve or reject a pending scan (releases or holds escrow).
# Must be run by the market verifier address (the publisher / oracle key).
# Usage: ./resolve-scan.sh <job_id> <index> <approve|reject> [reason] [content_hash]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/env.sh"

JOB="${1:?usage: resolve-scan.sh <job_id> <index> <approve|reject> [reason] [content_hash]}"
INDEX="${2:?usage: resolve-scan.sh <job_id> <index> <approve|reject> [reason] [content_hash]}"
DECISION="${3:?usage: resolve-scan.sh <job_id> <index> <approve|reject> [reason] [content_hash]}"
REASON="${4:-}"
CONTENT_HASH="${5:-}"

case "$DECISION" in
  approve|true|1) APPROVE=true; REASON="${REASON:-Evidence verified via Walrus re-fetch}" ;;
  reject|false|0) APPROVE=false; REASON="${REASON:-Rejected by verifier}" ;;
  *) echo "decision must be 'approve' or 'reject'"; exit 1 ;;
esac

echo "Resolving scan #$INDEX on $JOB → approve=$APPROVE reason=\"$REASON\""

sui client ptb \
  --move-call "$SCAN_PKG::scan_market::resolve_scan" @"$JOB" "$INDEX" "$APPROVE" "\"$REASON\"" "\"$CONTENT_HASH\"" \
  --gas-budget "$SCAN_GAS_BUDGET"
