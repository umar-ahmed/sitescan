import { createInterface } from "node:readline/promises";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chromium,
  firefox,
  webkit,
  devices,
  type Browser,
  type BrowserContext,
  type BrowserType,
} from "playwright";
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
import { checkPolicy } from "../src/lib/vetting";
import { detectCaptcha } from "../src/lib/captcha";
import { TlsnHarness, DEFAULT_NOTARY_URL } from "./tlsn/harness";
import { fetchEnsMetadata } from "./ens-metadata";
import { isEnsName, ensToUrl } from "../src/lib/ens";
import {
  TESTNET_SCAN_MARKET_PACKAGE_ID,
  TESTNET_MARKET_ID,
} from "../src/constants";

const PKG = process.env.SCAN_PKG ?? TESTNET_SCAN_MARKET_PACKAGE_ID!;
const MARKET = process.env.SCAN_MARKET ?? TESTNET_MARKET_ID!;
const RPC = process.env.SUI_RPC ?? "https://fullnode.testnet.sui.io:443";
const WALRUS_PUBLISHER = process.env.WALRUS_PUBLISHER;
const POLL_MS = Number(process.env.POLL_MS ?? 4000);

// TLSNotary: when enabled, the node also produces a real proof that the HTML was
// served by the target host over TLS, uploads the presentation to Walrus, and
// anchors that blob id on-chain. Requires a reachable notary (TLSN_NOTARY_URL)
// and a TLS 1.2-capable target (tlsn alpha.12 limitation).
const TLSN_ENABLED = !/^(0|false|no|off)$/i.test(
  process.env.TLSN_ENABLED ?? "1",
);
const TLSN_NOTARY_URL = process.env.TLSN_NOTARY_URL ?? DEFAULT_NOTARY_URL;

// A node serves exactly one vantage (geo / device / browser) and only claims
// jobs whose params match it. SCANNER_PROFILE selects the device; SCANNER_BROWSER
// and SCANNER_GEO override the browser engine and declared region.
const PROFILE = (process.env.SCANNER_PROFILE ?? "desktop").toLowerCase();

type Engine = "chromium" | "firefox" | "webkit";

// Requested/declared browser names → the real Playwright engine that renders it.
const ENGINE_OF: Record<string, Engine> = {
  chrome: "chromium",
  chromium: "chromium",
  edge: "chromium",
  safari: "webkit",
  webkit: "webkit",
  firefox: "firefox",
  ff: "firefox",
};

const ENGINES: Record<Engine, BrowserType> = { chromium, firefox, webkit };

// The browser a device profile defaults to when SCANNER_BROWSER is unset.
const DEFAULT_BROWSER: Record<string, string> = {
  desktop: "chrome",
  iphone: "safari",
  android: "chrome",
};

// Each device profile maps to a real Playwright device descriptor, which carries
// the accurate user-agent + viewport + touch settings for that phone. `null`
// means a plain desktop context that keeps the engine's own real UA.
const DEVICE_DESCRIPTOR: Record<string, string | null> = {
  desktop: null,
  iphone: "iPhone 15",
  android: "Pixel 7",
};

// This node's declared capability. Jobs are matched against it.
const CAP = {
  geo: (process.env.SCANNER_GEO ?? "US").toLowerCase(),
  device: DEVICE_DESCRIPTOR[PROFILE] !== undefined ? PROFILE : "desktop",
  browser: (
    process.env.SCANNER_BROWSER ??
    DEFAULT_BROWSER[PROFILE] ??
    "chrome"
  ).toLowerCase(),
};
const CAP_ENGINE: Engine = ENGINE_OF[CAP.browser] ?? "chromium";

// When set, the node ignores a job's requested geo and will claim jobs for any
// region. Geo is vantage metadata only (the node doesn't truly geolocate), so a
// single node can sequentially serve every geo's jobs. Device/browser still
// matter because they change how the page is actually rendered.
const IGNORE_GEO = /^(1|true|yes|on)$/i.test(
  process.env.SCANNER_IGNORE_GEO ?? "",
);

// Human-in-the-loop CAPTCHA solving: when a scan hits a bot-wall / CAPTCHA, the
// node opens a real (headed) browser so a person can solve the challenge, then
// re-captures the unblocked page. Requires an interactive terminal; auto-off
// when stdin isn't a TTY (e.g. CI) or SCANNER_HITL is explicitly disabled.
const HITL_ENABLED =
  !!process.stdin.isTTY &&
  !/^(0|false|no|off)$/i.test(process.env.SCANNER_HITL ?? "1");
// How long the human has to solve the challenge before the node gives up.
const HITL_TIMEOUT_MS = Number(process.env.SCANNER_HITL_TIMEOUT_MS ?? 180000);

// Build the browser-context options once: emulate the chosen device accurately,
// dropping the mobile-only fields that Firefox's engine doesn't support.
type ContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;
const contextOptions: ContextOptions = (() => {
  const name = DEVICE_DESCRIPTOR[CAP.device];
  if (name && devices[name]) {
    const d = devices[name];
    const opts: ContextOptions = {
      userAgent: d.userAgent,
      viewport: d.viewport,
      deviceScaleFactor: d.deviceScaleFactor,
      isMobile: d.isMobile,
      hasTouch: d.hasTouch,
    };
    if (CAP_ENGINE === "firefox") {
      opts.isMobile = undefined;
      opts.deviceScaleFactor = undefined;
      opts.hasTouch = undefined;
    }
    return opts;
  }
  return { viewport: { width: 1280, height: 800 } };
})();
const DEVICE_LABEL = DEVICE_DESCRIPTOR[CAP.device] ?? "desktop";

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

const handled = new Set<string>();

// Parse a job's vantage params into a lowercased map. Accepts both the CLI
// format ("geo=US;device=iphone;browser=safari") and the web UI's JSON format
// ('{"geo":"BR","device":"iphone","browser":"safari"}'). Values are lowercased
// so they compare cleanly against this node's capability.
function parseParams(params: string): Record<string, string> {
  const out: Record<string, string> = {};
  const add = (key: unknown, val: unknown) => {
    const k = String(key ?? "")
      .trim()
      .toLowerCase();
    const v = String(val ?? "")
      .trim()
      .toLowerCase();
    if (k && v) out[k] = v;
  };
  const trimmed = params.trim();
  if (trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        for (const [k, v] of Object.entries(parsed)) add(k, v);
        return out;
      }
    } catch {
      // fall through to key=value parsing
    }
  }
  for (const part of trimmed.split(/[;,]/)) {
    const [k, ...rest] = part.split("=");
    add(k, rest.join("="));
  }
  return out;
}

// Returns a human-readable reason if this node may NOT serve the job, else null.
// Every vantage field the job specifies must match the node; unspecified fields
// are treated as wildcards so legacy params-less jobs still get served.
function vantageMismatch(params: string): string | null {
  const want = parseParams(params);
  if (!IGNORE_GEO && want.geo && want.geo !== CAP.geo)
    return `geo ${want.geo}≠${CAP.geo}`;
  if (want.device && want.device !== CAP.device)
    return `device ${want.device}≠${CAP.device}`;
  if (want.browser) {
    const wantEngine = ENGINE_OF[want.browser] ?? want.browser;
    if (wantEngine !== CAP_ENGINE)
      return `browser ${want.browser}(${wantEngine})≠${CAP.browser}(${CAP_ENGINE})`;
  }
  return null;
}

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
  // One scan per node per job: never submit twice to the same job, even across
  // restarts (the in-memory `handled` set doesn't survive a process restart).
  if (job.json.submissions.some((s) => s.worker === address)) return null;
  return { url: job.json.url, params: job.json.params };
}

async function capture(
  browser: Browser,
  url: string,
): Promise<{ screenshot: Buffer; html: string }> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  let html: string;
  try {
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 20000 });
    // Best-effort settle for dynamic pages, but never fail on it: bot-walls
    // (Cloudflare, etc.) keep polling their challenge platform so the network
    // never goes idle — we still want their interstitial HTML for detection.
    await page
      .waitForLoadState("networkidle", { timeout: 8000 })
      .catch(() => {});
    html = await page.content();
  } catch (err) {
    // Even on a hard navigation failure, a challenge page may have rendered;
    // grab whatever is there before falling back to the synthetic notice.
    html = await page.content().catch(() => "");
    if (html.length < 200) {
      await page.setContent(
        `<html><body style="font-family:sans-serif;padding:40px">
       <h2>Scan of ${url}</h2>
       <p>Navigation failed: ${(err as Error).message}</p>
       <p>profile: ${CAP.device} / ${CAP.browser} (${CAP_ENGINE})</p></body></html>`,
      );
      html = await page.content();
    }
  }
  const screenshot = await page.screenshot({ type: "png", fullPage: false });
  await context.close();
  return { screenshot, html };
}

// Open a real, visible browser so a human can solve the challenge, then capture
// the unblocked page. Resolves with the post-solve evidence, or null if the
// person didn't confirm in time (in which case the caller skips the job).
interface SolvedCaptcha {
  screenshot: Buffer;
  html: string;
  // The exact credentials the human earned clearing the bot-wall, so the
  // TLSNotary prover can replay an authenticated request (cf_clearance etc. are
  // bound to the User-Agent that solved them).
  cookies: string;
  userAgent: string;
}

async function humanSolveCaptcha(
  url: string,
  provider: string,
): Promise<SolvedCaptcha | null> {
  console.log(`\n  🧩 ${provider} CAPTCHA detected on ${url}`);
  console.log(
    "  Opening a real Chrome window — solve the challenge, then press Enter here.",
  );
  // Bot-walls (Cloudflare/Turnstile) reject automation-fingerprinted browsers,
  // so the human's clicks just reload. Launch a persistent, low-fingerprint
  // session: real installed Chrome when available, with --enable-automation and
  // the AutomationControlled blink feature stripped, and navigator.webdriver
  // hidden. A persistent profile lets the challenge clearance cookie/PAT stick.
  const userDataDir = await mkdtemp(join(tmpdir(), "pos-hitl-"));
  const launchOpts = {
    headless: false,
    ignoreDefaultArgs: ["--enable-automation"],
    args: ["--disable-blink-features=AutomationControlled"],
    ...contextOptions,
  };
  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      channel: "chrome",
      ...launchOpts,
    });
  } catch {
    context = await chromium.launchPersistentContext(userDataDir, launchOpts);
  }
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
  });
  const page = context.pages()[0] ?? (await context.newPage());
  try {
    await page
      .goto(url, { waitUntil: "domcontentloaded", timeout: 30000 })
      .catch(() => undefined);

    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    const timeout = new Promise<"timeout">((resolve) =>
      setTimeout(() => resolve("timeout"), HITL_TIMEOUT_MS),
    );
    const answered = rl
      .question("  ✅ Press Enter once the page is past the challenge…\n")
      .then(() => "done" as const);
    const outcome = await Promise.race([answered, timeout]);
    rl.close();
    if (outcome === "timeout") {
      console.warn(
        `  ⏱️  No confirmation within ${Math.round(HITL_TIMEOUT_MS / 1000)}s — skipping job.`,
      );
      return null;
    }

    // Re-check: if the page is still showing the challenge, treat as unsolved.
    const html = await page.content();
    if (detectCaptcha(html)) {
      console.warn("  ✗ Page still shows a CAPTCHA — skipping job.");
      return null;
    }
    const screenshot = await page.screenshot({ type: "png", fullPage: false });
    const jar = await context.cookies(url);
    const cookies = jar.map((c) => `${c.name}=${c.value}`).join("; ");
    const userAgent = await page.evaluate(() => navigator.userAgent);
    console.log(
      `  ✓ Challenge cleared — captured the unblocked page (${jar.length} cookie(s) to reuse for the proof).`,
    );
    return { screenshot, html, cookies, userAgent };
  } finally {
    await context.close().catch(() => undefined);
    await rm(userDataDir, { recursive: true, force: true }).catch(
      () => undefined,
    );
  }
}

let tlsnHarness: TlsnHarness | null = null;

// TLSNotary proof of the target URL. Returns the Walrus blob id of the
// presentation, or "" if proving failed/unavailable (e.g. TLS 1.3, unsupported
// cipher). When TLSN is enabled the caller treats "" as a hard skip — there is
// no non-proof submission path.
const PROOF_TIMEOUT_MS = Number(process.env.TLSN_PROOF_TIMEOUT_MS ?? 240000);
// Max response bytes the prover buffers for the MPC transcript. Must exceed the
// target's full HTTP response (e.g. example.com ~0.5KB, but many real pages are
// 50KB+). Larger values cost more MPC time + memory, so it's tunable.
const TLSN_MAX_RECV = Number(process.env.TLSN_MAX_RECV ?? 131072);
// Head-only proving (backup for heavy pages): when > 0, the prover sends an HTTP
// Range request for just the first N bytes, so MPC cost stays bounded and a
// large page still proves in seconds. The full page is captured + stored on
// Walrus regardless; the proof only attests provenance of the head. Provenance
// accepts the resulting 206 Partial Content. 0 = adaptive (see below).
const TLSN_HEAD_BYTES = Number(process.env.TLSN_HEAD_BYTES ?? 0);
// Adaptive cap: when TLSN_HEAD_BYTES is 0, the node probes the raw response size
// and proves the full body only if it's at or under this many bytes; larger
// pages fall back to head-only proving of the first TLSN_FULL_MAX_BYTES bytes.
// MPC cost scales with bytes, so big bodies (e.g. 55KB) blow past any timeout —
// this keeps every proof bounded without manual flags.
const TLSN_FULL_MAX_BYTES = Number(process.env.TLSN_FULL_MAX_BYTES ?? 32768);
// Header headroom on top of the requested body bytes so the status line +
// response headers also fit under maxRecvData.
const TLSN_HEAD_HEADROOM = 8192;

// Cheaply probe the raw HTTP body size without downloading it: a Range request
// for one byte returns `Content-Range: bytes 0-0/<total>`; we cancel the body
// stream immediately. Returns null if the size can't be determined.
async function probeBodySize(
  url: string,
  creds: { cookies?: string; userAgent?: string },
): Promise<number | null> {
  try {
    const headers: Record<string, string> = { Range: "bytes=0-0" };
    if (creds.userAgent) headers["User-Agent"] = creds.userAgent;
    if (creds.cookies) headers.Cookie = creds.cookies;
    const res = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(15000),
    });
    const range = res.headers.get("content-range");
    const length = res.headers.get("content-length");
    await res.body?.cancel().catch(() => undefined);
    const total = range?.match(/\/(\d+)\s*$/)?.[1];
    if (total) return Number(total);
    if (length && res.status === 200) return Number(length);
    return null;
  } catch {
    return null;
  }
}

// Pick how many head bytes to notarize: an explicit TLSN_HEAD_BYTES forces
// head-only; otherwise probe the size and only fall back to head-only when the
// body exceeds the full-proof cap.
async function resolveHeadBytes(
  url: string,
  creds: { cookies?: string; userAgent?: string },
): Promise<number> {
  if (TLSN_HEAD_BYTES > 0) return TLSN_HEAD_BYTES;
  const size = await probeBodySize(url, creds);
  if (size === null) {
    console.log("  (couldn't probe page size — proving full response)");
    return 0;
  }
  if (size > TLSN_FULL_MAX_BYTES) {
    console.log(
      `  page body is ${(size / 1024).toFixed(0)}KB (> ${(TLSN_FULL_MAX_BYTES / 1024).toFixed(0)}KB cap) — proving head-only`,
    );
    return TLSN_FULL_MAX_BYTES;
  }
  console.log(
    `  page body is ${(size / 1024).toFixed(0)}KB — proving full response`,
  );
  return 0;
}

async function proveAndUpload(
  url: string,
  creds: { cookies?: string; userAgent?: string } = {},
): Promise<string> {
  if (!tlsnHarness) return "";
  const headBytes = await resolveHeadBytes(url, creds);
  const maxRecv =
    headBytes > 0 ? headBytes + TLSN_HEAD_HEADROOM : TLSN_MAX_RECV;
  try {
    const { presentationJSON } = await tlsnHarness.prove(
      url,
      maxRecv,
      PROOF_TIMEOUT_MS,
      { ...creds, headBytes },
    );
    const proofBlob = await uploadToWalrus(JSON.stringify(presentationJSON), {
      publisher: WALRUS_PUBLISHER,
      contentType: "application/json",
    });
    console.log(
      `  ✓ TLSNotary proof verified + uploaded to Walrus: ${proofBlob}`,
    );
    return proofBlob;
  } catch (err) {
    console.warn(`  TLSNotary proof skipped: ${(err as Error).message}`);
    return "";
  }
}

async function submit(
  jobId: string,
  ssBlob: string,
  htmlBlob: string,
  proofBlob: string,
  ensMetaBlob: string,
) {
  const tx = new Transaction();
  tx.add(
    submitScan({
      package: PKG,
      arguments: {
        job: jobId,
        screenshotBlobId: ssBlob,
        htmlBlobId: htmlBlob,
        notaryProofBlobId: proofBlob,
        ensMetadataBlobId: ensMetaBlob,
      },
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
  console.log(
    `Scanner node up · device=${CAP.device} (${DEVICE_LABEL}) · browser=${CAP.browser} (${CAP_ENGINE}) · geo=${IGNORE_GEO ? "any" : CAP.geo}`,
  );
  console.log(`address=${address}`);
  console.log(`Package=${PKG}\nMarket=${MARKET}\nPolling every ${POLL_MS}ms…`);
  console.log(
    HITL_ENABLED
      ? `Human-in-the-loop CAPTCHA solving ON · timeout=${Math.round(HITL_TIMEOUT_MS / 1000)}s`
      : "Human-in-the-loop CAPTCHA solving OFF (set SCANNER_HITL=1 in an interactive terminal)",
  );
  const browser = await ENGINES[CAP_ENGINE].launch({ headless: true });

  if (TLSN_ENABLED) {
    tlsnHarness = new TlsnHarness({ notaryUrl: TLSN_NOTARY_URL });
    await tlsnHarness.start();
    console.log(
      `TLSNotary proving ON · notary=${TLSN_NOTARY_URL} · ${
        TLSN_HEAD_BYTES > 0
          ? `head-only (${(TLSN_HEAD_BYTES / 1024).toFixed(0)}KB)`
          : `adaptive (full ≤${(TLSN_FULL_MAX_BYTES / 1024).toFixed(0)}KB, else head-only)`
      } · timeout=${Math.round(PROOF_TIMEOUT_MS / 1000)}s`,
    );
  } else {
    console.log(
      "TLSNotary proving OFF (TLSN_ENABLED=0) — scans submitted without a proof will be rejected by the verifier.",
    );
  }

  // Claim and fully process exactly one matching job (capture → prove → submit),
  // then return. Cheap skips (already handled, wrong vantage, policy-denied) move
  // on to the next candidate; a real scan attempt ends the pass.
  const scanOne = async (): Promise<void> => {
    const jobs = await getJobIds();
    for (const jobId of jobs) {
      if (handled.has(jobId)) continue;
      const claim = await jobIsClaimable(jobId);
      if (!claim) {
        handled.add(jobId);
        continue;
      }
      const skip = vantageMismatch(claim.params);
      if (skip) {
        console.log(`· skip ${jobId} — wants ${skip}`);
        handled.add(jobId);
        continue;
      }
      // ENS names resolve to a contenthash gateway URL we actually render/prove.
      const scanUrl = isEnsName(claim.url) ? ensToUrl(claim.url) : claim.url;
      const policy = checkPolicy(scanUrl);
      if (!policy.allowed) {
        console.log(
          `  skipping policy-denied URL: ${scanUrl} (${policy.reason})`,
        );
        handled.add(jobId);
        continue;
      }
      handled.add(jobId);
      console.log(`\n→ scanning ${scanUrl} [${claim.params}] for job ${jobId}`);
      let { screenshot, html } = await capture(browser, scanUrl);

      // Bot-wall / CAPTCHA: the headless capture can't get past it, so hand off
      // to a human in a real browser and re-capture the unblocked page.
      let proofCreds: { cookies?: string; userAgent?: string } = {};
      const captcha = detectCaptcha(html);
      if (captcha) {
        if (!HITL_ENABLED) {
          console.warn(
            `  ✗ ${captcha} CAPTCHA on ${scanUrl} and human-in-the-loop is off (SCANNER_HITL=0 or no TTY) — skipping job.`,
          );
          return;
        }
        const solved = await humanSolveCaptcha(scanUrl, captcha);
        if (!solved) return;
        screenshot = solved.screenshot;
        html = solved.html;
        proofCreds = { cookies: solved.cookies, userAgent: solved.userAgent };
      }
      console.log(
        `  ✓ captured page · ${(html.length / 1024).toFixed(1)} KB html · ${(screenshot.length / 1024).toFixed(1)} KB screenshot`,
      );

      let proofBlob = "";
      if (TLSN_ENABLED) {
        console.log(
          `  → generating TLSNotary proof via ${TLSN_NOTARY_URL} (up to ${Math.round(PROOF_TIMEOUT_MS / 1000)}s)…`,
        );
        proofBlob = await proveAndUpload(scanUrl, proofCreds);
        if (!proofBlob) {
          console.warn(
            `  ✗ no TLSNotary proof for ${scanUrl} — not submitting (TLSNotary required, no fallback)`,
          );
          return;
        }
      }

      console.log("  → uploading screenshot + html to Walrus…");
      const ssBlob = await uploadToWalrus(screenshot, {
        publisher: WALRUS_PUBLISHER,
        contentType: "image/png",
      });
      const htmlBlob = await uploadToWalrus(html, {
        publisher: WALRUS_PUBLISHER,
        contentType: "text/html",
      });
      console.log(
        `  ✓ uploaded to Walrus: screenshot=${ssBlob} html=${htmlBlob}`,
      );

      // If the job target is an ENS name, attach its resolved metadata too.
      let ensMetaBlob = "";
      const ensMetadata = await fetchEnsMetadata(claim.url).catch(() => null);
      if (ensMetadata) {
        ensMetaBlob = await uploadToWalrus(
          JSON.stringify(ensMetadata, null, 2),
          {
            publisher: WALRUS_PUBLISHER,
            contentType: "application/json",
          },
        );
        console.log(`  ✓ ENS metadata uploaded: ${ensMetaBlob}`);
      }
      console.log("  → submitting scan on-chain…");
      const digest = await submit(
        jobId,
        ssBlob,
        htmlBlob,
        proofBlob,
        ensMetaBlob,
      );
      console.log(`  ✓ submitted — pending verifier payout · digest=${digest}`);
      return;
    }
  };

  // Self-scheduling loop instead of setInterval: a new pass only starts after the
  // previous one finishes, so the node never runs two scans (or two proofs) at
  // once and never double-submits the same job.
  const loop = async () => {
    try {
      await scanOne();
    } catch (err) {
      console.error("scan error:", (err as Error).message);
    } finally {
      setTimeout(loop, POLL_MS);
    }
  };
  await loop();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
