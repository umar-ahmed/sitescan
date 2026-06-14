#!/usr/bin/env bash
# Submit a scan to a job (manual / CLI fallback for a scanner node).
# Usage: ./submit-scan.sh <job_id> [screenshot_blob_id] [html_blob_id] [notary_proof_blob_id]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/env.sh"

JOB="${1:?usage: submit-scan.sh <job_id> [screenshot_blob_id] [html_blob_id] [notary_proof_blob_id]}"
SS_BLOB="${2:-walrus-ss-$(date +%s)}"
HTML_BLOB="${3:-walrus-html-$(date +%s)}"
PROOF_BLOB="${4:-}"

echo "Submitting scan to $JOB  screenshot=$SS_BLOB  html=$HTML_BLOB  proof=$PROOF_BLOB"

sui client ptb \
  --move-call "$SCAN_PKG::scan_market::submit_scan" @"$JOB" "\"$SS_BLOB\"" "\"$HTML_BLOB\"" "\"$PROOF_BLOB\"" \
  --gas-budget "$SCAN_GAS_BUDGET"
