import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import {
  Market,
  ScanJob,
  resolveScan,
  setCloaking,
} from "../src/contracts/scan_market/scan_market";
import { DEFAULT_WALRUS_AGGREGATOR } from "../src/lib/walrus";
import { type JobVerdict, type VerdictStore, vetJob } from "../src/lib/vetting";
import {
  TESTNET_SCAN_MARKET_PACKAGE_ID,
  TESTNET_MARKET_ID,
} from "../src/constants";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERDICTS_PATH =
  process.env.VERDICTS_PATH ?? join(ROOT, "public/cre-verdicts.json");

const PKG = process.env.SCAN_PKG ?? TESTNET_SCAN_MARKET_PACKAGE_ID!;
const MARKET = process.env.SCAN_MARKET ?? TESTNET_MARKET_ID!;
const RPC = process.env.SUI_RPC ?? "https://fullnode.testnet.sui.io:443";
const WALRUS_AGGREGATOR =
  process.env.WALRUS_AGGREGATOR ?? DEFAULT_WALRUS_AGGREGATOR;
const POLL_MS = Number(process.env.POLL_MS ?? 8000);
const RUN_ONCE = process.argv.includes("--once");

const SUB_PENDING = 0;
const STATUS_OPEN = 0;

const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC });

const verifierSecret = process.env.VERIFIER_SECRET_KEY;
const verifierKeypair = verifierSecret
  ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(verifierSecret).secretKey)
  : null;
const verifierAddress = verifierKeypair?.getPublicKey().toSuiAddress();

interface ChainSubmission {
  index: number;
  screenshot_blob_id: string;
  html_blob_id: string;
  status: number;
}

interface ChainJob {
  id: string;
  url: string;
  status: number;
  submissions: ChainSubmission[];
}

async function loadJobs(): Promise<ChainJob[]> {
  const market = await Market.get({ client, objectId: MARKET });
  const jobIds = [...market.json.jobs];
  if (jobIds.length === 0) return [];
  const jobs = await ScanJob.getMany({ client, objectIds: jobIds });
  return jobs.map((j) => ({
    id: j.json.id,
    url: j.json.url,
    status: Number(j.json.status),
    submissions: j.json.submissions.map((s, index) => ({
      index,
      screenshot_blob_id: s.screenshot_blob_id,
      html_blob_id: s.html_blob_id,
      status: Number(s.status),
    })),
  }));
}

async function writeVerdicts(jobs: Record<string, JobVerdict>) {
  const store: VerdictStore = {
    updatedAt: Date.now(),
    verifier: verifierAddress ? `oracle:${verifierAddress}` : "terminal-c",
    jobs,
  };
  await mkdir(dirname(VERDICTS_PATH), { recursive: true });
  await writeFile(VERDICTS_PATH, JSON.stringify(store, null, 2));
}

function logVerdict(v: JobVerdict) {
  const delta = v.cloakingDelta
    ? ` · cloaking=${v.cloakingDelta.clusters} cluster(s)`
    : "";
  console.log(
    `[CRE verify] ${v.status} job=${v.jobId.slice(0, 10)}… url=${v.url}${delta}`,
  );
  if (v.reason) console.log(`             ${v.reason}`);
}

async function resolveOnChain(
  job: ChainJob,
  verdict: JobVerdict,
): Promise<void> {
  if (!verifierKeypair) return;
  if (job.status !== STATUS_OPEN) return;

  const decisions = job.submissions
    .filter((s) => s.status === SUB_PENDING)
    .map((s) => {
      const sv = verdict.submissions[s.index];
      const approve = sv?.status === "VERIFIED";
      return {
        index: s.index,
        approve,
        reason:
          sv?.reason ??
          (approve ? "Evidence verified via Walrus re-fetch" : "Rejected"),
        contentHash: sv?.htmlContentHash ?? "",
      };
    });
  if (decisions.length === 0) return;

  const tx = new Transaction();
  for (const d of decisions) {
    tx.add(
      resolveScan({
        package: PKG,
        arguments: {
          job: job.id,
          index: BigInt(d.index),
          approve: d.approve,
          verdictReason: d.reason,
          contentHash: d.contentHash,
        },
      }),
    );
  }
  if (verdict.cloakingDelta) {
    tx.add(
      setCloaking({
        package: PKG,
        arguments: {
          job: job.id,
          clusters: BigInt(verdict.cloakingDelta.clusters),
          detail: verdict.cloakingDelta.detail,
        },
      }),
    );
  }
  const res = await client.signAndExecuteTransaction({
    signer: verifierKeypair,
    transaction: tx,
  });
  if (res.$kind === "FailedTransaction") {
    console.error(`  on-chain resolve failed for job ${job.id.slice(0, 10)}…`);
    return;
  }
  await client.waitForTransaction({ result: res });
  for (const d of decisions) {
    console.log(
      `             ↳ on-chain ${d.approve ? "APPROVED (paid)" : "REJECTED (held)"} scan #${d.index}`,
    );
  }
}

async function tick(existing: Record<string, JobVerdict>) {
  const jobs = await loadJobs();
  const next = { ...existing };

  for (const job of jobs) {
    if (job.submissions.length === 0) continue;
    const verdict = await vetJob({
      jobId: job.id,
      url: job.url,
      submissions: job.submissions,
      walrusAggregator: WALRUS_AGGREGATOR,
      verifier: verifierAddress ? `oracle:${verifierAddress}` : "terminal-c",
    });
    next[job.id] = verdict;
    logVerdict(verdict);
    try {
      await resolveOnChain(job, verdict);
    } catch (err) {
      console.error("  resolve error:", (err as Error).message);
    }
  }

  await writeVerdicts(next);
  return next;
}

async function main() {
  console.log("CRE verifier (Terminal C) — independent scan evidence vetting");
  console.log(`Market=${MARKET}`);
  console.log(`Walrus=${WALRUS_AGGREGATOR}`);
  console.log(`Verdicts → ${VERDICTS_PATH}`);
  if (verifierAddress) {
    console.log(`Verifier key=${verifierAddress} (resolves payouts on-chain)`);
  } else {
    console.log(
      "No VERIFIER_SECRET_KEY set — read-only mode (writes verdicts, no on-chain payout).",
    );
  }
  if (RUN_ONCE) {
    console.log("Mode: single pass (--once)\n");
  } else {
    console.log(`Polling every ${POLL_MS}ms…\n`);
  }

  let cache: Record<string, JobVerdict> = {};
  cache = await tick(cache);

  if (RUN_ONCE) return;

  setInterval(() => {
    tick(cache)
      .then((updated) => {
        cache = updated;
      })
      .catch((err) => {
        console.error("verify tick error:", (err as Error).message);
      });
  }, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
