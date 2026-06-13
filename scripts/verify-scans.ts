import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Market, ScanJob } from "../src/contracts/scan_market/scan_market";
import {
  DEFAULT_WALRUS_AGGREGATOR,
} from "../src/lib/walrus";
import {
  type JobVerdict,
  type VerdictStore,
  vetJob,
} from "../src/lib/vetting";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const VERDICTS_PATH =
  process.env.VERDICTS_PATH ?? join(ROOT, "public/cre-verdicts.json");

const MARKET =
  process.env.SCAN_MARKET ??
  "0x18ab02a8ff7f2290080452d3b5a5c1d338ea995f54b58f767e44048a831c9cd7";
const RPC = process.env.SUI_RPC ?? "https://fullnode.testnet.sui.io:443";
const WALRUS_AGGREGATOR =
  process.env.WALRUS_AGGREGATOR ?? DEFAULT_WALRUS_AGGREGATOR;
const POLL_MS = Number(process.env.POLL_MS ?? 8000);
const RUN_ONCE = process.argv.includes("--once");

const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC });

async function loadJobs(): Promise<
  Array<{
    id: string;
    url: string;
    submissions: Array<{
      screenshot_blob_id: string;
      html_blob_id: string;
    }>;
  }>
> {
  const market = await Market.get({ client, objectId: MARKET });
  const jobIds = [...market.json.jobs];
  if (jobIds.length === 0) return [];
  const jobs = await ScanJob.getMany({ client, objectIds: jobIds });
  return jobs.map((j) => ({
    id: j.json.id,
    url: j.json.url,
    submissions: j.json.submissions.map((s) => ({
      screenshot_blob_id: s.screenshot_blob_id,
      html_blob_id: s.html_blob_id,
    })),
  }));
}

async function writeVerdicts(jobs: Record<string, JobVerdict>) {
  const store: VerdictStore = {
    updatedAt: Date.now(),
    verifier: "terminal-c",
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
      verifier: "terminal-c",
    });
    next[job.id] = verdict;
    logVerdict(verdict);
  }

  await writeVerdicts(next);
  return next;
}

async function main() {
  console.log("CRE verifier (Terminal C) — independent scan evidence vetting");
  console.log(`Market=${MARKET}`);
  console.log(`Walrus=${WALRUS_AGGREGATOR}`);
  console.log(`Verdicts → ${VERDICTS_PATH}`);
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
