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

export interface CloakingDelta {
  clusters: number;
  uniform: boolean;
  detail: string;
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
  if (
    url.startsWith("http://") === false &&
    url.startsWith("https://") === false
  ) {
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

export async function sha256Hex(data: string | Uint8Array): Promise<string> {
  const buf =
    typeof data === "string"
      ? new TextEncoder().encode(data)
      : new Uint8Array(data);
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
