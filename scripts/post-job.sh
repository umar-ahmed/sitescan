#!/usr/bin/env bash
# Post a scan job, escrowing a SUI reward.
# Usage: ./post-job.sh <url> <reward_sui> [geo] [device] [browser]
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/env.sh"

URL="${1:?usage: post-job.sh <url> <reward_sui> <scans> [geo] [device] [browser]}"
REWARD_SUI="${2:?reward in SUI required, e.g. 0.05}"
SCANS="${3:?number of scans (slots) required, e.g. 2}"
GEO="${4:-US}"
DEVICE="${5:-iphone}"
BROWSER="${6:-safari}"

MIST="$(node -e "process.stdout.write(String(Math.round(Number(process.argv[1]) * 1e9)))" "$REWARD_SUI")"
PARAMS="geo=$GEO;device=$DEVICE;browser=$BROWSER"
PARAM_ARG="\"$PARAMS\""
URL_ARG="\"$URL\""

echo "Posting job: $URL  reward=$REWARD_SUI SUI ($MIST MIST)  scans=$SCANS  params=$PARAMS" >&2

OUT="$(sui client ptb \
  --split-coins gas "[$MIST]" \
  --assign reward \
  --move-call "$SCAN_PKG::scan_market::post_job" @"$SCAN_MARKET" reward.0 "$URL_ARG" "$PARAM_ARG" "$SCANS" \
  --gas-budget "$SCAN_GAS_BUDGET" --json)"

echo "$OUT" | node -e '
  let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
    const r=JSON.parse(s);
    const job=(r.objectChanges||[]).find(c=>(c.objectType||"").endsWith("::scan_market::ScanJob"));
    process.stderr.write(`status: ${r.effects?.status?.status}\ndigest: ${r.digest}\n`);
    if(job) process.stdout.write(job.objectId + "\n");
  });'
