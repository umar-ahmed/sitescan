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
import {
  DEFAULT_WALRUS_AGGREGATOR,
  walrusAggregatorUrl,
} from "../src/lib/walrus";
import { type JobVerdict, type VerdictStore, vetJob } from "../src/lib/vetting";
import {
  TlsnHarness,
  DEFAULT_NOTARY_URL,
  type PresentationJSON,
} from "./tlsn/harness";
import { checkProvenance, notaryPemToKeyHex } from "../src/lib/tlsnotary";
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

// TLSNotary: when enabled, a submission's payout is gated on a verifiable proof
// that the target host served the HTML over TLS, signed by the trusted notary.
const TLSN_ENABLED = !/^(0|false|no|off)$/i.test(
  process.env.TLSN_ENABLED ?? "1",
);
const TLSN_NOTARY_URL = process.env.TLSN_NOTARY_URL ?? DEFAULT_NOTARY_URL;

const SUB_PENDING = 0;
const STATUS_OPEN = 0;

const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC });

const verifierSecret = process.env.VERIFIER_SECRET_KEY;
const verifierKeypair = verifierSecret
  ? Ed25519Keypair.fromSecretKey(decodeSuiPrivateKey(verifierSecret).secretKey)
  : null;
const verifierAddress = verifierKeypair?.getPublicKey().toSuiAddress();

let tlsnHarness: TlsnHarness | null = null;
let trustedNotaryKeyHex = "";

async function fetchTrustedNotaryKey(): Promise<string> {
  const res = await fetch(`${TLSN_NOTARY_URL}/info`);
  const info = (await res.json()) as { publicKey: string };
  return notaryPemToKeyHex(info.publicKey);
}

interface ProofVerdict {
  approve: boolean;
  reason: string;
  contentHash: string;
  // True when verification couldn't complete due to verifier-side infra (Walrus
  // fetch, harness crash) rather than a bad proof. Transient verdicts must NOT
  // be resolved on-chain — the submission stays pending and is retried, so a
  // verifier hiccup never holds a worker's funds or burns their one attempt.
  transient: boolean;
}

// Download the presentation from Walrus and re-run the deterministic provenance
// check (notary signature + proven host + HTML). This is the payout gate.
async function verifyProof(
  jobUrl: string,
  proofBlobId: string,
): Promise<ProofVerdict> {
  if (!tlsnHarness) {
    return {
      approve: false,
      reason: "Verifier has no notary configured",
      contentHash: "",
      transient: true,
    };
  }
  let presentationJSON: PresentationJSON;
  try {
    const res = await fetch(
      walrusAggregatorUrl(proofBlobId, WALRUS_AGGREGATOR),
      {
        signal: AbortSignal.timeout(45000),
      },
    );
    if (!res.ok) throw new Error(`Walrus fetch ${res.status}`);
    presentationJSON = (await res.json()) as PresentationJSON;
  } catch (err) {
    return {
      approve: false,
      reason: `Could not fetch proof from Walrus: ${(err as Error).message}`,
      contentHash: "",
      transient: true,
    };
  }
  try {
    const verified = await tlsnHarness.verify(presentationJSON);
    const provenance = await checkProvenance(verified, {
      expectedHost: new URL(jobUrl).hostname,
      trustedNotaryKeyHex,
    });
    return {
      approve: provenance.status === "PROVEN",
      reason: provenance.reason,
      contentHash: provenance.htmlContentHash ?? "",
      transient: false,
    };
  } catch (err) {
    return {
      approve: false,
      reason: `Verifier could not run the proof check: ${(err as Error).message}`,
      contentHash: "",
      transient: true,
    };
  }
}

interface ChainSubmission {
  index: number;
  screenshot_blob_id: string;
  html_blob_id: string;
  notary_proof_blob_id: string;
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
      notary_proof_blob_id: s.notary_proof_blob_id,
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
    `[verify] ${v.status} job=${v.jobId.slice(0, 10)}… url=${v.url}${delta}`,
  );
  if (v.reason) console.log(`         ${v.reason}`);
}

async function resolveOnChain(
  job: ChainJob,
  verdict: JobVerdict,
): Promise<void> {
  if (!verifierKeypair) return;
  if (job.status !== STATUS_OPEN) return;

  const pending = job.submissions.filter((s) => s.status === SUB_PENDING);
  const decisions = await Promise.all(
    pending.map(async (s) => {
      // When TLSNotary is enabled it is the only acceptance path: a submission
      // must carry a proof that cryptographically verifies, or it is rejected.
      // No heuristic / Walrus re-fetch fallback.
      if (TLSN_ENABLED) {
        if (!s.notary_proof_blob_id) {
          return {
            index: s.index,
            approve: false,
            reason: "No TLSNotary proof attached (proof required, no fallback)",
            contentHash: "",
            transient: false,
          };
        }
        const proof = await verifyProof(job.url, s.notary_proof_blob_id);
        return {
          index: s.index,
          approve: proof.approve,
          reason: proof.reason,
          contentHash: proof.contentHash,
          transient: proof.transient,
        };
      }
      const sv = verdict.submissions[s.index];
      const approve = sv?.status === "VERIFIED";
      return {
        index: s.index,
        approve,
        reason:
          sv?.reason ??
          (approve ? "Evidence verified via Walrus re-fetch" : "Rejected"),
        contentHash: sv?.htmlContentHash ?? "",
        transient: false,
      };
    }),
  );
  if (decisions.length === 0) return;

  // Transient verdicts (Walrus/harness failures) are left pending and retried
  // next poll, so a verifier-side hiccup never wrongly rejects a valid proof.
  const transient = decisions.filter((d) => d.transient);
  const actionable = decisions.filter((d) => !d.transient);
  for (const d of transient) {
    console.log(
      `[verify] job=${job.id.slice(0, 10)}… url=${job.url}\n         RETRY scan #${d.index} — ${d.reason}`,
    );
  }
  if (actionable.length === 0) return;

  if (TLSN_ENABLED) {
    const cloak = verdict.cloakingDelta
      ? ` · cloaking=${verdict.cloakingDelta.clusters} cluster(s)`
      : "";
    console.log(`[verify] job=${job.id.slice(0, 10)}… url=${job.url}${cloak}`);
    for (const d of actionable) {
      console.log(
        `         ${d.approve ? "PROVEN" : "REJECTED"} scan #${d.index} — ${d.reason}`,
      );
    }
  }

  const tx = new Transaction();
  for (const d of actionable) {
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
  for (const d of actionable) {
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
    // When TLSNotary is the gate, resolveOnChain logs the proof-based verdict
    // per submission; the heuristic vetJob output is only used for the cloaking
    // delta + the UI verdict store, so don't print it as if it were the decision.
    if (!TLSN_ENABLED) logVerdict(verdict);
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
  console.log(
    "Proof-of-Scan verifier — TLSNotary provenance gate for scan payouts",
  );
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
  if (TLSN_ENABLED) {
    trustedNotaryKeyHex = await fetchTrustedNotaryKey();
    tlsnHarness = new TlsnHarness({ notaryUrl: TLSN_NOTARY_URL });
    await tlsnHarness.start();
    console.log(
      `TLSNotary gating ON · notary=${TLSN_NOTARY_URL} · key=${trustedNotaryKeyHex.slice(0, 14)}…`,
    );
  } else {
    console.log(
      "TLSNotary gating OFF (TLSN_ENABLED=0) — falling back to Walrus re-fetch heuristic.",
    );
  }
  if (RUN_ONCE) {
    console.log("Mode: single pass (--once)\n");
  } else {
    console.log(`Polling every ${POLL_MS}ms…\n`);
  }

  let cache: Record<string, JobVerdict> = {};
  cache = await tick(cache);

  if (RUN_ONCE) {
    await tlsnHarness?.stop();
    return;
  }

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
