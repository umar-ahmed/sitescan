import { normalizeHtmlForHash, sha256Hex } from "./vetting";

export interface TlsnVerifierOutput {
  server_name?: string;
  connection_info?: Record<string, unknown>;
  transcript?: { sent?: number[]; recv?: number[] };
}

export interface VerifiedPresentation {
  verifyingKeyHex: string;
  out: TlsnVerifierOutput;
}

export interface HttpResponse {
  statusLine: string;
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export type ProvenanceStatus = "PROVEN" | "REJECTED";

export interface ProvenanceResult {
  status: ProvenanceStatus;
  reason: string;
  serverName?: string;
  statusCode?: number;
  htmlContentHash?: string;
}

export interface ProvenancePolicy {
  expectedHost: string;
  trustedNotaryKeyHex: string;
}

const CRLF = "\r\n";

// Decode the revealed `recv` transcript bytes into text.
export function decodeRecv(out: TlsnVerifierOutput): string {
  const recv = out.transcript?.recv;
  if (!Array.isArray(recv)) return "";
  return new TextDecoder().decode(Uint8Array.from(recv));
}

// Parse a raw HTTP/1.1 response transcript. Bodies sent with chunked transfer
// encoding keep their chunk-size lines; we strip those so the body matches the
// rendered HTML the scanner stored.
export function parseHttpResponse(raw: string): HttpResponse | null {
  const headerEnd = raw.indexOf(CRLF + CRLF);
  if (headerEnd === -1) return null;

  const head = raw.slice(0, headerEnd);
  const rawBody = raw.slice(headerEnd + 4);
  const [statusLine, ...headerLines] = head.split(CRLF);

  const statusMatch = statusLine.match(/^HTTP\/\d\.\d\s+(\d{3})/);
  if (!statusMatch) return null;

  const headers: Record<string, string> = {};
  for (const line of headerLines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line
      .slice(idx + 1)
      .trim();
  }

  const isChunked = (headers["transfer-encoding"] ?? "").includes("chunked");
  const body = isChunked ? dechunk(rawBody) : rawBody;

  return {
    statusLine,
    statusCode: Number(statusMatch[1]),
    headers,
    body,
  };
}

function dechunk(raw: string): string {
  let out = "";
  let rest = raw;
  while (rest.length > 0) {
    const nl = rest.indexOf(CRLF);
    if (nl === -1) {
      out += rest;
      break;
    }
    const size = parseInt(rest.slice(0, nl).trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    const start = nl + 2;
    out += rest.slice(start, start + size);
    rest = rest.slice(start + size + 2);
  }
  return out;
}

// The notary /info public key is SPKI DER (PEM). The presentation's verifying
// key is the trailing 33-byte compressed EC point; compare against it.
export function notaryPemToKeyHex(pem: string): string {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(Buffer.from(b64, "base64"));
  const point = der.slice(der.length - 33);
  return Array.from(point)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function hostMatches(serverName: string, expectedHost: string): boolean {
  const s = serverName.toLowerCase();
  const h = expectedHost.toLowerCase();
  if (s === h) return true;
  const bare = h.startsWith("www.") ? h.slice(4) : h;
  return s === bare || s === `www.${bare}`;
}

// Decide whether a verified presentation actually proves the expected host
// served HTML over TLS, signed by the trusted notary. This is the deterministic
// "Role B" check a verifier (or a DON quorum) re-runs.
export async function checkProvenance(
  verified: VerifiedPresentation,
  policy: ProvenancePolicy,
): Promise<ProvenanceResult> {
  const serverName = verified.out.server_name ?? "";

  if (
    verified.verifyingKeyHex.toLowerCase() !==
    policy.trustedNotaryKeyHex.toLowerCase()
  ) {
    return {
      status: "REJECTED",
      reason: "Presentation was signed by an untrusted notary key",
      serverName,
    };
  }

  if (!serverName || !hostMatches(serverName, policy.expectedHost)) {
    return {
      status: "REJECTED",
      reason: `Proven server "${serverName}" does not match job host "${policy.expectedHost}"`,
      serverName,
    };
  }

  const response = parseHttpResponse(decodeRecv(verified.out));
  if (!response) {
    return {
      status: "REJECTED",
      reason: "Revealed transcript is not a parseable HTTP response",
      serverName,
    };
  }
  if (response.statusCode >= 400) {
    return {
      status: "REJECTED",
      reason: `Server returned HTTP ${response.statusCode}`,
      serverName,
      statusCode: response.statusCode,
    };
  }

  const htmlContentHash = await sha256Hex(normalizeHtmlForHash(response.body));
  return {
    status: "PROVEN",
    reason: `TLS provenance verified: ${serverName} served HTTP ${response.statusCode}, notary-signed`,
    serverName,
    statusCode: response.statusCode,
    htmlContentHash,
  };
}
