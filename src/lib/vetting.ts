export const DEFAULT_DENY_HOSTS = [
  "instagram.com",
  "www.instagram.com",
  "facebook.com",
  "www.facebook.com",
  "linkedin.com",
  "www.linkedin.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "www.tiktok.com",
];

export type VerdictStatus =
  | "PENDING"
  | "VERIFIED"
  | "REJECTED_POLICY"
  | "REJECTED_FAKE";

export interface SubmissionVerdict {
  index: number;
  screenshotBlobId: string;
  htmlBlobId: string;
  status: VerdictStatus;
  reason?: string;
  htmlContentHash?: string;
}

export interface CloakingDelta {
  clusters: number;
  uniform: boolean;
  detail: string;
}

export interface JobVerdict {
  jobId: string;
  url: string;
  status: VerdictStatus;
  reason?: string;
  cloakingDelta?: CloakingDelta;
  submissions: SubmissionVerdict[];
  verifiedAt: number;
  verifier: string;
}

export interface VerdictStore {
  updatedAt: number;
  verifier: string;
  jobs: Record<string, JobVerdict>;
}

export function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function checkPolicy(
  url: string,
  denyHosts: readonly string[] = DEFAULT_DENY_HOSTS,
): { allowed: boolean; reason?: string } {
  const host = hostFromUrl(url);
  if (!host) {
    return { allowed: false, reason: "Invalid URL" };
  }
  if (url.startsWith("http://") === false && url.startsWith("https://") === false) {
    return { allowed: false, reason: "Only http(s) URLs allowed" };
  }
  for (const denied of denyHosts) {
    const d = denied.toLowerCase();
    if (host === d || host.endsWith(`.${d}`)) {
      return {
        allowed: false,
        reason: `Policy blocked: ${host} is not an allowed scan target`,
      };
    }
  }
  return { allowed: true };
}

export function htmlReferencesHost(html: string, jobUrl: string): boolean {
  const host = hostFromUrl(jobUrl);
  if (!host) return false;
  const lower = html.toLowerCase();
  const jobLower = jobUrl.toLowerCase();

  if (lower.includes(host) || lower.includes(jobLower)) return true;

  const bare = host.startsWith("www.") ? host.slice(4) : host;
  if (lower.includes(bare)) return true;

  const canonical =
    lower.match(/rel=["']canonical["'][^>]*href=["']([^"']+)["']/)?.[1] ??
    lower.match(/property=["']og:url["'][^>]*content=["']([^"']+)["']/)?.[1];
  if (canonical) {
    const canonicalHost = hostFromUrl(canonical);
    if (canonicalHost === host || canonicalHost?.endsWith(`.${bare}`)) {
      return true;
    }
  }

  if (host === "example.com" && lower.includes("example domain")) return true;
  if (host === "example.org" && lower.includes("example domain")) return true;

  return false;
}

export function isValidPng(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < sig.length; i++) {
    if (bytes[i] !== sig[i]) return false;
  }
  return bytes.length > 500;
}

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf =
    typeof data === "string" ? new TextEncoder().encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return (
    "0x" +
    Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function normalizeHtmlForHash(html: string): string {
  return html
    .replace(/\s+/g, " ")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim()
    .slice(0, 50000)
    .toLowerCase();
}

export function computeCloakingDelta(contentHashes: string[]): CloakingDelta {
  const unique = new Set(contentHashes);
  const clusters = unique.size;
  if (clusters <= 1) {
    return {
      clusters: 1,
      uniform: true,
      detail: "All submissions show the same content cluster",
    };
  }
  return {
    clusters,
    uniform: false,
    detail: `${clusters} distinct content clusters across ${contentHashes.length} submissions (possible cloaking)`,
  };
}

export async function fetchWalrusBlob(
  aggregator: string,
  blobId: string,
  timeoutMs = 45000,
): Promise<Uint8Array> {
  const res = await fetch(`${aggregator}/v1/blobs/${blobId}`, {
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`Walrus fetch failed (${blobId}): ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

export interface VetSubmissionInput {
  index: number;
  screenshotBlobId: string;
  htmlBlobId: string;
  jobUrl: string;
  walrusAggregator: string;
}

export async function vetSubmission(
  input: VetSubmissionInput,
): Promise<SubmissionVerdict> {
  const base: SubmissionVerdict = {
    index: input.index,
    screenshotBlobId: input.screenshotBlobId,
    htmlBlobId: input.htmlBlobId,
    status: "REJECTED_FAKE",
  };
  try {
    const [png, htmlBytes] = await Promise.all([
      fetchWalrusBlob(input.walrusAggregator, input.screenshotBlobId),
      fetchWalrusBlob(input.walrusAggregator, input.htmlBlobId),
    ]);
    if (!isValidPng(png)) {
      return { ...base, reason: "Screenshot is not a valid PNG" };
    }
    const html = new TextDecoder().decode(htmlBytes);
    if (!htmlReferencesHost(html, input.jobUrl)) {
      return {
        ...base,
        reason: "HTML evidence does not reference the job URL host",
      };
    }
    const htmlContentHash = await sha256Hex(normalizeHtmlForHash(html));
    return {
      ...base,
      status: "VERIFIED",
      htmlContentHash,
    };
  } catch (err) {
    return {
      ...base,
      reason: (err as Error).message,
    };
  }
}

export interface VetJobInput {
  jobId: string;
  url: string;
  submissions: Array<{
    screenshot_blob_id: string;
    html_blob_id: string;
  }>;
  walrusAggregator: string;
  denyHosts?: readonly string[];
  verifier?: string;
}

export async function vetJob(input: VetJobInput): Promise<JobVerdict> {
  const verifier = input.verifier ?? "terminal-c";
  const verifiedAt = Date.now();

  if (input.submissions.length === 0) {
    return {
      jobId: input.jobId,
      url: input.url,
      status: "PENDING",
      submissions: [],
      verifiedAt,
      verifier,
    };
  }

  const policy = checkPolicy(input.url, input.denyHosts);
  if (!policy.allowed) {
    return {
      jobId: input.jobId,
      url: input.url,
      status: "REJECTED_POLICY",
      reason: policy.reason,
      submissions: input.submissions.map((s, index) => ({
        index,
        screenshotBlobId: s.screenshot_blob_id,
        htmlBlobId: s.html_blob_id,
        status: "REJECTED_POLICY" as const,
        reason: policy.reason,
      })),
      verifiedAt,
      verifier,
    };
  }

  const submissionVerdicts = await Promise.all(
    input.submissions.map((s, index) =>
      vetSubmission({
        index,
        screenshotBlobId: s.screenshot_blob_id,
        htmlBlobId: s.html_blob_id,
        jobUrl: input.url,
        walrusAggregator: input.walrusAggregator,
      }),
    ),
  );

  const allVerified = submissionVerdicts.every((s) => s.status === "VERIFIED");
  const hashes = submissionVerdicts
    .map((s) => s.htmlContentHash)
    .filter((h): h is string => h !== undefined);

  const cloakingDelta =
    hashes.length > 1 ? computeCloakingDelta(hashes) : undefined;

  if (!allVerified) {
    const firstFail = submissionVerdicts.find((s) => s.status !== "VERIFIED");
    return {
      jobId: input.jobId,
      url: input.url,
      status: "REJECTED_FAKE",
      reason: firstFail?.reason ?? "Evidence failed integrity checks",
      cloakingDelta,
      submissions: submissionVerdicts,
      verifiedAt,
      verifier,
    };
  }

  return {
    jobId: input.jobId,
    url: input.url,
    status: "VERIFIED",
    reason:
      cloakingDelta && !cloakingDelta.uniform
        ? cloakingDelta.detail
        : "Evidence independently verified against Walrus blobs",
    cloakingDelta,
    submissions: submissionVerdicts,
    verifiedAt,
    verifier,
  };
}
