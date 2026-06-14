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
import { computeCloakingDelta } from "../src/lib/vetting";
import {
  TlsnHarness,
  DEFAULT_NOTARY_URL,
  type PresentationJSON,
} from "./tlsn/harness";
import { checkProvenance, notaryPemToKeyHex } from "../src/lib/tlsnotary";
import { isEnsName, ensGatewayHost } from "../src/lib/ens";
import {
  TESTNET_SCAN_MARKET_PACKAGE_ID,
  TESTNET_MARKET_ID,
} from "../src/constants";

const PKG = process.env.SCAN_PKG ?? TESTNET_SCAN_MARKET_PACKAGE_ID!;
const MARKET = process.env.SCAN_MARKET ?? TESTNET_MARKET_ID!;
const RPC = process.env.SUI_RPC ?? "https://fullnode.testnet.sui.io:443";
const WALRUS_AGGREGATOR =
  process.env.WALRUS_AGGREGATOR ?? DEFAULT_WALRUS_AGGREGATOR;
const POLL_MS = Number(process.env.POLL_MS ?? 8000);
const RUN_ONCE = process.argv.includes("--once");

// TLSNotary is the sole payout gate: a submission is paid only if it carries a
// proof that cryptographically verifies the target host served the HTML over
// TLS, signed by the trusted notary. There is no heuristic / Walrus-re-fetch
// fallback.
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
    // ENS jobs are proven against the resolver gateway host (the page the node
    // actually rendered), not the bare ".eth" name.
    const expectedHost = isEnsName(jobUrl)
      ? ensGatewayHost(jobUrl)
      : new URL(jobUrl).hostname;
    const provenance = await checkProvenance(verified, {
      expectedHost,
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
  content_hash: string;
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
      content_hash: s.content_hash,
      status: Number(s.status),
    })),
  }));
}

async function resolveOnChain(job: ChainJob): Promise<void> {
  if (!verifierKeypair) return;
  if (job.status !== STATUS_OPEN) return;

  const pending = job.submissions.filter((s) => s.status === SUB_PENDING);
  if (pending.length === 0) return;

  // TLSNotary is the only acceptance path: a submission must carry a proof that
  // cryptographically verifies, or it is rejected.
  const decisions = await Promise.all(
    pending.map(async (s) => {
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
    }),
  );

  // Transient verdicts (Walrus/harness failures) are left pending and retried
  // next poll, so a verifier-side hiccup never wrongly rejects a valid proof.
  const transient = decisions.filter((d) => d.transient);
  for (const d of transient) {
    console.log(
      `[verify] job=${job.id.slice(0, 10)}… url=${job.url}\n         RETRY scan #${d.index} — ${d.reason}`,
    );
  }
  const actionable = decisions.filter((d) => !d.transient);
  if (actionable.length === 0) return;

  console.log(`[verify] job=${job.id.slice(0, 10)}… url=${job.url}`);
  for (const d of actionable) {
    console.log(
      `         ${d.approve ? "PROVEN" : "REJECTED"} scan #${d.index} — ${d.reason}`,
    );
  }

  // Cloaking is pure content-hash clustering across the job's submissions: the
  // hashes already recorded on-chain plus the hashes from this round's proven
  // scans. It is not an accept/reject heuristic — every paid scan is already
  // TLS-proven; this only flags that vantages saw different pages.
  const contentHashes = [
    ...job.submissions.map((s) => s.content_hash),
    ...actionable.filter((d) => d.approve).map((d) => d.contentHash),
  ].filter(Boolean);
  const uniqueHashes = [...new Set(contentHashes)];
  const cloakingDelta =
    uniqueHashes.length > 1 ? computeCloakingDelta(uniqueHashes) : undefined;

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
  if (cloakingDelta) {
    tx.add(
      setCloaking({
        package: PKG,
        arguments: {
          job: job.id,
          clusters: BigInt(cloakingDelta.clusters),
          detail: cloakingDelta.detail,
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

async function tick() {
  const jobs = await loadJobs();
  for (const job of jobs) {
    if (job.submissions.length === 0) continue;
    try {
      await resolveOnChain(job);
    } catch (err) {
      console.error("  resolve error:", (err as Error).message);
    }
  }
}

async function main() {
  console.log(
    "Proof-of-Scan verifier — TLSNotary provenance gate for scan payouts",
  );
  console.log(`Market=${MARKET}`);
  console.log(`Walrus=${WALRUS_AGGREGATOR}`);
  if (verifierAddress) {
    console.log(`Verifier key=${verifierAddress} (resolves payouts on-chain)`);
  } else {
    console.log(
      "No VERIFIER_SECRET_KEY set — read-only mode (no on-chain payout).",
    );
  }
  trustedNotaryKeyHex = await fetchTrustedNotaryKey();
  tlsnHarness = new TlsnHarness({ notaryUrl: TLSN_NOTARY_URL });
  await tlsnHarness.start();
  console.log(
    `TLSNotary gating ON · notary=${TLSN_NOTARY_URL} · key=${trustedNotaryKeyHex.slice(0, 14)}…`,
  );
  if (RUN_ONCE) {
    console.log("Mode: single pass (--once)\n");
  } else {
    console.log(`Polling every ${POLL_MS}ms…\n`);
  }

  await tick();

  if (RUN_ONCE) {
    await tlsnHarness?.stop();
    return;
  }

  setInterval(() => {
    tick().catch((err) => {
      console.error("verify tick error:", (err as Error).message);
    });
  }, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
