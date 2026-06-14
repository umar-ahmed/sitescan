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

1. **Post a job** — requester escrows SUI for `scans` verified slots (web or
   CLI).
2. **Scan** — each scanner node captures the page (device profile → varied
   screenshots), uploads to Walrus, and calls `submit_scan` with the blob ids.
   The scan is recorded **PENDING**; no payout yet.
3. **Verify (per scan) → pay** — the verifier re-fetches each submission from
   Walrus, enforces policy + URL/HTML integrity, and calls `resolve_scan`:
   approved scans release their portion to the worker, rejected scans keep their
   funds in escrow (reclaimable / re-scannable). Payout is gated on
   verification.
4. **Render + reclaim** — the requester's page renders the Walrus screenshots
   and per-scan verdicts; once the job settles they can reclaim leftover escrow.

Verification is **per scan, not per job**: a single fake submission is rejected
and unpaid without blocking the legitimate scans in the same job.

## Stack

- **Sui Move** (`move/scan_market`) — escrow, job registry, per-submission
  payout.
- **@mysten/dapp-kit-react** + generated TS bindings (`pnpm codegen`).
- **React + Vite + Tailwind** frontend (requester view).
- **Playwright** headless capture in the scanner node
  (`scripts/scanner-node.ts`).
- **Walrus** testnet publisher/aggregator for evidence + proof storage
  (`src/lib/walrus.ts`).
- **TLSNotary** provenance — self-hosted notary (Docker) + in-process `tlsn-js`
  prover/verifier (`scripts/tlsn/`, `src/lib/tlsnotary.ts`); the verifier
  (`pnpm verify`) gates payout on the proof. See
  [TLSNotary provenance](#tlsnotary-provenance-prove-the-html-was-really-served).

## Deployed (Sui testnet)

- Package: `0x3b93a7619e0e669afc51ab8a32f52183209c233ceae6b5ce9a5694cf595c9b4a`
- Market (shared object):
  `0xdc011f87b4c99a680bc2274a95284cee1b7759d4101f96af1f2f51af03b21f9c`
- Verifier (oracle) address = the publisher of the package; only this address
  can call `resolve_scan`. In production this stands in for the CRE DON report.

## TLSNotary provenance (prove the HTML was really served)

The integrity heuristic ("does the HTML mention the host?") is forgeable. With
**TLSNotary**, a scanner produces a cryptographic proof that the target host
actually served the HTML over TLS — without the server's cooperation. The
verifier (or, in production, a DON quorum) re-runs a deterministic check: notary
signature valid → proven `server_name` == job host → HTTP 2xx → HTML content
hash. Payout is gated on that proof.

### Where each piece runs

| Piece                        | Where it lives                                                                                                                                                                                                                                                                                                                                                                                                                                       | You start it?                          |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Notary** (`notary-server`) | The **hosted instance** `https://proof-of-scan-notary-production.up.railway.app` (Railway; see [`notary/`](notary/README.md)), **or** a **local Docker container** `tlsn-notary` on `http://127.0.0.1:7047`. Self-hosted — it _is_ the verifier, not a trusted external service. The hosted instance uses a **pinned** secp256k1 key (redeploy-safe); local Docker uses an ephemeral key. The verifier fetches the live key from `/info` either way. | Hosted: no · Local: `pnpm tlsn:notary` |
| **Prover** (`tlsn-js` wasm)  | **Not a separate service.** `scripts/tlsn/harness.ts` spins up, _inside the scanner (and verifier) process_, an in-process static server + a WebSocket→TCP proxy + a headless Chromium page that runs the real MPC prover.                                                                                                                                                                                                                           | No — automatic                         |
| **Provenance check**         | `src/lib/tlsnotary.ts`, run by the verifier (`pnpm verify`).                                                                                                                                                                                                                                                                                                                                                                                         | No — automatic                         |
| **Evidence + proof storage** | **Walrus testnet** (public).                                                                                                                                                                                                                                                                                                                                                                                                                         | No                                     |
| **Escrow + verdicts**        | **Sui testnet** (public, already deployed above).                                                                                                                                                                                                                                                                                                                                                                                                    | No                                     |

So the **only long-running thing you launch for the notary layer is the Docker
container**. Everything else (prover, proxy, headless browser) is started and
torn down by the `pnpm scan` / `pnpm verify` processes. Proofs are TLS 1.2 only
(tlsn alpha.12).

### Quick check (no chain, ~15s)

Uses the hosted notary by default — no Docker needed.

```bash
pnpm tlsn:prove "https://example.com/"              # real MPC proof → scripts/tlsn/out/…
pnpm tlsn:verify scripts/tlsn/out/example.com.presentation.json example.com
# → PROVEN — TLS provenance verified: example.com served HTTP 200, notary-signed
# local notary instead? `pnpm tlsn:notary` then export TLSN_NOTARY_URL=http://127.0.0.1:7047
```

### Full demo (5 terminals)

Run these from `scan-market-app/`. Use a **TLS 1.2-capable target**
(`https://example.com/` works; many sites are TLS 1.3-only and can't be proven
yet).

```bash
# one-time
pnpm install
pnpm exec playwright install chromium
export SUI_SECRET_KEY="$(sui keytool export --key-identity $(sui client active-address) --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).exportedPrivateKey))')"
export VERIFIER_SECRET_KEY="$SUI_SECRET_KEY"   # publisher key = the on-chain verifier
# notary defaults to the hosted instance; for a local one:
#   pnpm tlsn:notary && export TLSN_NOTARY_URL=http://127.0.0.1:7047
```

| #   | Terminal       | Command                                                                 |
| --- | -------------- | ----------------------------------------------------------------------- |
| 1   | **Notary**     | hosted by default (no terminal needed) — or `pnpm tlsn:notary` locally  |
| 2   | **Web UI**     | `pnpm dev` → http://localhost:5173                                      |
| 3   | **Post a job** | `./scripts/post-job.sh "https://example.com/" 0.02 1 US desktop chrome` |
| 4   | **Scanner**    | `SUI_SECRET_KEY=$SUI_SECRET_KEY pnpm scan`                              |
| 5   | **Verifier**   | `VERIFIER_SECRET_KEY=$VERIFIER_SECRET_KEY pnpm verify`                  |

Flow: the scanner renders the page, produces a TLSNotary proof, uploads the
screenshot + HTML + **presentation** to Walrus, and submits the proof blob id
on-chain. The verifier fetches the presentation from Walrus, re-verifies
provenance against the notary key, and **releases payout only if the proof
checks out** — writing the verdict into the submission's `verdict_reason` +
`content_hash`. The web UI shows the **TLS-proven · notary-signed** badge and a
link to the proof. TLSNotary is **on by default** — a scan with no valid proof
is rejected and never paid (set `TLSN_ENABLED=0` to fall back to the Walrus
re-fetch heuristic). The notary defaults to the hosted instance; set
`TLSN_NOTARY_URL=http://127.0.0.1:7047` to use a local `pnpm tlsn:notary`.

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

## 3) Verifier — gates payout on the TLSNotary proof

Run this in a **separate terminal** while the dev server is up. It polls Sui,
and — when given the verifier key — **resolves each pending scan on-chain**
(approve → pay worker, reject → hold). With `TLSN_ENABLED=1` it fetches each
submission's presentation from Walrus and releases payout **only if the
provenance proof verifies** (notary signature → proven host → HTTP 2xx → HTML
hash); the verdict is written into the submission's `verdict_reason` +
`content_hash`. Without `TLSN_ENABLED` it falls back to the Walrus re-fetch
heuristic.

```bash
# verifier key = the package publisher's key (the only address allowed to resolve)
export VERIFIER_SECRET_KEY="$(sui keytool export --key-identity $(sui client active-address) --json | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).exportedPrivateKey))')"

TLSN_ENABLED=1 pnpm verify       # poll every 8s, verify proofs, resolve pending scans
TLSN_ENABLED=1 pnpm verify:once  # single pass (good for testing)
```

Without `VERIFIER_SECRET_KEY` it runs read-only (no on-chain payout). Needs the
notary running (`pnpm tlsn:notary`).

### Full demo (5 terminals)

| Terminal     | Command                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| **Notary**   | `pnpm tlsn:notary` (Docker, `:7047`)                                    |
| Web          | `pnpm dev`                                                              |
| Post a job   | `./scripts/post-job.sh "https://example.com/" 0.02 1 US desktop chrome` |
| Scanner      | `TLSN_ENABLED=1 SUI_SECRET_KEY=… pnpm scan`                             |
| **Verifier** | `TLSN_ENABLED=1 VERIFIER_SECRET_KEY=… pnpm verify`                      |

Use a **TLS 1.2-capable target** (`https://example.com/`); TLS 1.3-only sites
can't be proven yet (tlsn alpha.12).

CLI fallbacks:

```bash
# manual submission with placeholder blobs (records PENDING, no payout)
./scripts/submit-scan.sh <job_id> [screenshot_blob_id] [html_blob_id] [notary_proof_blob_id]
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
- `submit_scan(job, screenshot_blob_id, html_blob_id, notary_proof_blob_id)` —
  records a **PENDING** submission; pays nothing. Accepts scans while
  `approved + pending < max`. `notary_proof_blob_id` is the Walrus blob id of
  the TLSNotary presentation (empty string if the node submitted no proof).
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
