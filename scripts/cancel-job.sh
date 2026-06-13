#!/usr/bin/env bash
# Cancel an open job and refund the escrow to the requester.
# Usage: ./cancel-job.sh <job_id>
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/env.sh"

JOB="${1:?usage: cancel-job.sh <job_id>}"

sui client ptb \
  --move-call "$SCAN_PKG::scan_market::cancel_job" @"$JOB" \
  --gas-budget "$SCAN_GAS_BUDGET"
