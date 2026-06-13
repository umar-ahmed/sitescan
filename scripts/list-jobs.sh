#!/usr/bin/env bash
# List all scan jobs in the market with their status.
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$DIR/env.sh"

JOB_IDS="$(sui client object "$SCAN_MARKET" --json 2>/dev/null \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{const r=JSON.parse(s);process.stdout.write((r.content.jobs||[]).join(" "));})')"

if [ -z "$JOB_IDS" ]; then
  echo "No jobs posted yet."
  exit 0
fi

for id in $JOB_IDS; do
  sui client object "$id" --json 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
      const c=JSON.parse(s).content;
      const status=["open","completed","cancelled"][Number(c.status)]||c.status;
      const subStatus=["pending","approved","rejected"];
      const reward=(Number(c.reward_total)/1e9).toString();
      const subs=Array.isArray(c.submissions)?c.submissions:[];
      const cloak=Number(c.cloaking_clusters)>0?`   cloaking: ${c.cloaking_clusters} cluster(s) — ${c.cloaking_detail}`:"";
      console.log(`- ${process.argv[1]}\n    url: ${c.url}\n    params: ${c.params}\n    reward: ${reward} SUI   verified: ${c.approved_count}/${c.max_submissions}   pending: ${c.pending_count}   attempts: ${subs.length}   status: ${status}${cloak}`);
      for (const sub of subs){
        const f=sub.fields||sub;
        const st=subStatus[Number(f.status)]||f.status;
        const reason=f.verdict_reason?`  verdict="${f.verdict_reason}"`:"";
        console.log(`      • [${st}] ${f.worker}  paid=${(Number(f.paid)/1e9)} SUI${reason}  ss=${f.screenshot_blob_id}  html=${f.html_blob_id}`);
      }
    });' "$id"
done
