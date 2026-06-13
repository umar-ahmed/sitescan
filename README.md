# Proof of Scan — scan-market (Sui + Walrus POC)

A decentralized URL scan marketplace on Sui. A requester escrows a SUI reward
against a target URL and a desired vantage (geo / device / browser) and asks for
N independent, **verified** scans. **Terminal scanner nodes** listen for open
jobs, render the page in a headless browser, upload the screenshot + HTML to
**Walrus**, and submit the resulting blob ids on-chain. Each submission lands as
**PENDING and is paid nothing** until an independent verifier approves it — so
fake evidence never earns from the escrow. The requester sees every incoming
screenshot rendered from Walrus on their page.

Flows, end to end:

1. **Post a job** — requester escrows SUI for `scans` verified slots (web or CLI).
2. **Scan** — each scanner node captures the page (device profile → varied
   screenshots), uploads to Walrus, and calls `submit_scan` with the blob ids.
   The scan is recorded **PENDING**; no payout yet.
3. **Verify (per scan) → pay** — the verifier re-fetches each submission from
   Walrus, enforces policy + URL/HTML integrity, and calls `resolve_scan`:
   approved scans release their portion to the worker, rejected scans keep their
   funds in escrow (reclaimable / re-scannable). Payout is gated on verification.
4. **Render + reclaim** — the requester's page renders the Walrus screenshots and
   per-scan verdicts; once the job settles they can reclaim leftover escrow.

Verification is **per scan, not per job**: a single fake submission is rejected
and unpaid without blocking the legitimate scans in the same job.

## Stack

- **Sui Move** (`move/scan_market`) — escrow, job registry, per-submission
  payout.
- **@mysten/dapp-kit-react** + generated TS bindings (`pnpm codegen`).
- **React + Vite + Tailwind** frontend (requester view).
- **Playwright** headless capture in the scanner node
  (`scripts/scanner-node.ts`).
- **Walrus** testnet publisher/aggregator for evidence storage
  (`src/lib/walrus.ts`).
- **CRE vetting** — Terminal C verifier (`pnpm verify`) + optional Chainlink CRE
  workflow in `../cre-vetting/` (see [cre-vetting/README.md](../cre-vetting/README.md)).

## Deployed (Sui testnet)

- Package: `0x47448cd79e2037a04b9cc5b80bf31f6e65840431db707a57be0d9bf506accf81`
- Market (shared object):
  `0x0b180cf8e40938a10ab20008731a083231f5309a7760636536bfaded08a21c04`
- Verifier (oracle) address = the publisher of the package; only this address can
  call `resolve_scan`. In production this stands in for the CRE DON report.

## Prerequisites

- Node 18+, `pnpm`
- Sui CLI (`brew install sui`), configured for testnet
- A funded testnet address. Fund via the web faucet:
  `https://faucet.sui.io/?network=testnet` (paste your
  `sui client active-address`).
- Playwright Chromium (one-time): `pnpm exec playwright install chromium`

## 1) Requester — post a job

Web:

```bash
pnpm install
pnpm dev   # http://localhost:5173
```

Connect a Sui **testnet** wallet (the dev build also exposes a burner wallet),
set the URL + vantage + reward + **scans wanted**, and post the job. Incoming
scans render on the same page as scanner nodes complete them.

Or via CLI (prints the new job id on stdout):

```bash
# <url> <reward_sui> <scans> [geo] [device] [browser]
./scripts/post-job.sh "https://example.com" 0.04 2 US desktop chrome
```

## 2) Scanner node — listen, capture, earn

Each terminal you run is a scanner node. Give it a Sui key to sign with and a
device profile so screenshots vary:

```bash
# one-time: export your CLI key (any funded testnet key works)
export SUI_SECRET_KEY="$(sui keytool export --key-identity $(sui client active-address) --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).exportedPrivateKey))')"

# terminal A — desktop scanner
SCANNER_PROFILE=desktop pnpm scan
# terminal B — iphone scanner (varied screenshot)
SCANNER_PROFILE=iphone  pnpm scan
```

Each node polls the `Market`, scans every open job once, uploads to Walrus, and
submits — filling one slot per job. Env knobs: `SCANNER_PROFILE`
(`desktop`/`iphone`/`android`), `POLL_MS`, `SCAN_PKG`, `SCAN_MARKET`, `SUI_RPC`,
`WALRUS_PUBLISHER`.

Policy-denied URLs (Instagram, Facebook, etc.) are skipped by scanner nodes.

## 3) Terminal C — verifier (gates payout + badges in UI)

Run this in a **separate terminal** while the dev server is up. It polls Sui,
re-fetches each submission from Walrus, checks policy + integrity, writes
`public/cre-verdicts.json` for the UI, and — when given the verifier key —
**resolves each pending scan on-chain** (approve → pay worker, reject → hold):

```bash
# verifier key = the package publisher's key (the only address allowed to resolve)
export VERIFIER_SECRET_KEY="$(sui keytool export --key-identity $(sui client active-address) --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).exportedPrivateKey))')"

pnpm verify          # poll every 8s, resolve pending scans
pnpm verify:once     # single pass (good for testing)
```

Without `VERIFIER_SECRET_KEY` it runs read-only (writes verdicts, no on-chain
payout).

### Full demo (4 terminals)

| Terminal | Command |
|----------|---------|
| Web | `pnpm dev` |
| Scanner desktop | `SUI_SECRET_KEY=… SCANNER_PROFILE=desktop pnpm scan` |
| Scanner iphone | `SUI_SECRET_KEY=… SCANNER_PROFILE=iphone pnpm scan` |
| **Verifier** | `VERIFIER_SECRET_KEY=… pnpm verify` |

Optional: Chainlink CRE CLI simulate — see `../cre-vetting/README.md`.

CLI fallbacks:

```bash
# manual submission with placeholder blobs (records PENDING, no payout)
./scripts/submit-scan.sh <job_id> [screenshot_blob_id] [html_blob_id]
# verifier-only: approve/reject a pending scan
./scripts/resolve-scan.sh <job_id> <index> <approve|reject>
```

## Other CLI

```bash
./scripts/list-jobs.sh            # every job: verified/pending/attempts + per-scan status
./scripts/cancel-job.sh <job_id>  # requester refund of remaining escrow (open job)
```

## Redeploy the contract

```bash
rm -f move/scan_market/Published.toml   # allow a fresh publish
sui client publish --gas-budget 200000000 move/scan_market
# then update src/constants.ts + scripts/env.sh with the new package + Market ids,
# and regenerate bindings:
node_modules/.bin/sui-ts-codegen generate
```

## Move module

`move/scan_market/sources/scan_market.move`

- `post_job(market, reward: Coin<SUI>, url, params, max_submissions)` — escrows
  the reward, copies the market `verifier`, shares a `ScanJob`, registers it.
- `submit_scan(job, screenshot_blob_id, html_blob_id)` — records a **PENDING**
  submission; pays nothing. Accepts scans while `approved + pending < max`.
- `resolve_scan(job, index, approve, verdict_reason, content_hash)` —
  **verifier-only**. Approve releases that scan's `per_scan` portion to the
  worker; reject holds the funds. The CRE verdict (`verdict_reason` + HTML
  `content_hash`) is stored on the submission. Completes the job once
  `max_submissions` scans are approved.
- `set_cloaking(job, clusters, detail)` — verifier-only. Records the cloaking
  summary (distinct content clusters across the job's scans) on-chain.
- `cancel_job(job)` — requester-only refund of remaining escrow (open job).
- `reclaim_remainder(job)` — requester-only sweep of leftover escrow once the
  job is completed or cancelled.

The verifier's output is persisted **on-chain** (per-scan `verdict_reason` +
`content_hash`, job-level `cloaking_clusters` + `cloaking_detail`) and rendered
in the UI from chain. Emits `JobPosted` / `ScanSubmitted` / `ScanResolved` /
`CloakingRecorded` / `JobCompleted` events.
