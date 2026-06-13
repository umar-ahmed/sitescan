# Proof of Scan — scan-market (Sui + Walrus POC)

A decentralized URL scan marketplace on Sui. A requester escrows a SUI reward
against a target URL and a desired vantage (geo / device / browser) and asks for
N independent scans. **Terminal scanner nodes** listen for open jobs, render the
page in a headless browser, upload the screenshot + HTML to **Walrus**, and
submit the resulting blob ids on-chain. Each submission is paid an equal portion
of the reward; when all slots fill, the job completes. The requester sees every
incoming screenshot rendered from Walrus on their page.

Flows, end to end:

1. **Post a job** — requester escrows SUI for `scans` slots (web or CLI).
2. **Scan** — each scanner node captures the page (device profile → varied
   screenshots), uploads to Walrus, and calls `submit_scan` with the blob ids.
3. **Get paid + render** — the node receives its portion of the bounty; the
   requester's page renders the Walrus screenshots as they arrive.

## Stack

- **Sui Move** (`move/scan_market`) — escrow, job registry, per-submission
  payout.
- **@mysten/dapp-kit-react** + generated TS bindings (`pnpm codegen`).
- **React + Vite + Tailwind** frontend (requester view).
- **Playwright** headless capture in the scanner node
  (`scripts/scanner-node.ts`).
- **Walrus** testnet publisher/aggregator for evidence storage
  (`src/lib/walrus.ts`).

## Deployed (Sui testnet)

- Package: `0x3bf1b39719b8c0b263d65d21196b04b2ff6567f9b0b3279dffed05c9bbc6b792`
- Market (shared object):
  `0x18ab02a8ff7f2290080452d3b5a5c1d338ea995f54b58f767e44048a831c9cd7`

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

# terminal A
SCANNER_PROFILE=desktop pnpm scan
# terminal B
SCANNER_PROFILE=iphone  pnpm scan
# terminal C
SCANNER_PROFILE=android pnpm scan
```

Each node polls the `Market`, scans every open job once, uploads to Walrus, and
submits — filling one slot per job. Env knobs: `SCANNER_PROFILE`
(`desktop`/`iphone`/`android`), `POLL_MS`, `SCAN_PKG`, `SCAN_MARKET`, `SUI_RPC`,
`WALRUS_PUBLISHER`.

CLI fallback (manual submission with placeholder blobs):

```bash
./scripts/submit-scan.sh <job_id> [screenshot_blob_id] [html_blob_id]
```

## Other CLI

```bash
./scripts/list-jobs.sh            # every job, slots filled, and each submission
./scripts/cancel-job.sh <job_id>  # requester refund of remaining escrow
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
  the reward, shares a `ScanJob`, registers it in the `Market`.
- `submit_scan(job, screenshot_blob_id, html_blob_id)` — pays an equal portion
  of the reward, records the submission; completes the job on the final slot.
- `cancel_job(job)` — requester-only refund of the remaining escrow.

Emits `JobPosted` / `ScanSubmitted` / `JobCompleted` events.
