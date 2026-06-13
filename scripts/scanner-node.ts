import { chromium, type Browser } from "playwright";
import { SuiGrpcClient } from "@mysten/sui/grpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Transaction } from "@mysten/sui/transactions";
import {
  Market,
  ScanJob,
  submitScan,
} from "../src/contracts/scan_market/scan_market";
import { uploadToWalrus } from "../src/lib/walrus";

const PKG =
  process.env.SCAN_PKG ??
  "0x3bf1b39719b8c0b263d65d21196b04b2ff6567f9b0b3279dffed05c9bbc6b792";
const MARKET =
  process.env.SCAN_MARKET ??
  "0x18ab02a8ff7f2290080452d3b5a5c1d338ea995f54b58f767e44048a831c9cd7";
const RPC = process.env.SUI_RPC ?? "https://fullnode.testnet.sui.io:443";
const WALRUS_PUBLISHER = process.env.WALRUS_PUBLISHER;
const POLL_MS = Number(process.env.POLL_MS ?? 4000);
const PROFILE = process.env.SCANNER_PROFILE ?? "desktop";

const PROFILES: Record<
  string,
  {
    viewport: { width: number; height: number };
    userAgent: string;
    isMobile: boolean;
    deviceScaleFactor: number;
  }
> = {
  desktop: {
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    isMobile: false,
    deviceScaleFactor: 1,
  },
  iphone: {
    viewport: { width: 390, height: 844 },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    isMobile: true,
    deviceScaleFactor: 3,
  },
  android: {
    viewport: { width: 360, height: 800 },
    userAgent:
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36",
    isMobile: true,
    deviceScaleFactor: 2.6,
  },
};

const secret = process.env.SUI_SECRET_KEY;
if (!secret) {
  console.error(
    "Missing SUI_SECRET_KEY (a suiprivkey... string).\n" +
      "Export your CLI key with:  sui keytool export --key-identity $(sui client active-address)\n" +
      "Then run:  SUI_SECRET_KEY=suiprivkey... SCANNER_PROFILE=iphone pnpm scan",
  );
  process.exit(1);
}

const { secretKey } = decodeSuiPrivateKey(secret);
const keypair = Ed25519Keypair.fromSecretKey(secretKey);
const address = keypair.getPublicKey().toSuiAddress();
const client = new SuiGrpcClient({ network: "testnet", baseUrl: RPC });
const profile = PROFILES[PROFILE] ?? PROFILES.desktop;

const handled = new Set<string>();

async function getJobIds(): Promise<string[]> {
  const market = await Market.get({ client, objectId: MARKET });
  return [...market.json.jobs];
}

async function jobIsClaimable(
  jobId: string,
): Promise<{ url: string; params: string } | null> {
  const [job] = await ScanJob.getMany({ client, objectIds: [jobId] });
  const status = Number(job.json.status);
  const max = Number(job.json.max_submissions);
  if (status !== 0 || job.json.submissions.length >= max) return null;
  return { url: job.json.url, params: job.json.params };
}

async function capture(
  browser: Browser,
  url: string,
): Promise<{ screenshot: Buffer; html: string }> {
  const context = await browser.newContext({
    viewport: profile.viewport,
    userAgent: profile.userAgent,
    isMobile: profile.isMobile,
    deviceScaleFactor: profile.deviceScaleFactor,
  });
  const page = await context.newPage();
  let html: string;
  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 20000 });
    html = await page.content();
  } catch (err) {
    await page.setContent(
      `<html><body style="font-family:sans-serif;padding:40px">
       <h2>Scan of ${url}</h2>
       <p>Navigation failed: ${(err as Error).message}</p>
       <p>profile: ${PROFILE}</p></body></html>`,
    );
    html = await page.content();
  }
  const screenshot = await page.screenshot({ type: "png", fullPage: false });
  await context.close();
  return { screenshot, html };
}

async function submit(jobId: string, ssBlob: string, htmlBlob: string) {
  const tx = new Transaction();
  tx.add(
    submitScan({
      package: PKG,
      arguments: { job: jobId, screenshotBlobId: ssBlob, htmlBlobId: htmlBlob },
    }),
  );
  const res = await client.signAndExecuteTransaction({
    signer: keypair,
    transaction: tx,
  });
  if (res.$kind === "FailedTransaction") {
    throw new Error("submit_scan transaction failed");
  }
  await client.waitForTransaction({ result: res });
  return res.Transaction.digest;
}

async function main() {
  console.log(`Scanner node up · profile=${PROFILE} · address=${address}`);
  console.log(`Package=${PKG}\nMarket=${MARKET}\nPolling every ${POLL_MS}ms…`);
  const browser = await chromium.launch({ headless: true });

  const tick = async () => {
    try {
      const jobs = await getJobIds();
      for (const jobId of jobs) {
        if (handled.has(jobId)) continue;
        const claim = await jobIsClaimable(jobId);
        if (!claim) {
          handled.add(jobId);
          continue;
        }
        handled.add(jobId);
        console.log(`\n→ scanning ${claim.url} for job ${jobId}`);
        const { screenshot, html } = await capture(browser, claim.url);
        const ssBlob = await uploadToWalrus(screenshot, {
          publisher: WALRUS_PUBLISHER,
          contentType: "image/png",
        });
        const htmlBlob = await uploadToWalrus(html, {
          publisher: WALRUS_PUBLISHER,
          contentType: "text/html",
        });
        console.log(
          `  uploaded to Walrus: screenshot=${ssBlob} html=${htmlBlob}`,
        );
        const digest = await submit(jobId, ssBlob, htmlBlob);
        console.log(`  submitted · digest=${digest}`);
      }
    } catch (err) {
      console.error("tick error:", (err as Error).message);
    }
  };

  await tick();
  setInterval(tick, POLL_MS);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
