/**
 * Extracts a bare ENS name from an input that may include a scheme or path
 * (e.g. "https://vitalik.eth/foo" → "vitalik.eth"), or null if it isn't one.
 */
export function ensNameFrom(input: string): string | null {
  const host = input
    .trim()
    .replace(/^https?:\/\//i, "")
    .split(/[/?#]/)[0]
    .toLowerCase();
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.eth$/.test(host) ? host : null;
}

/**
 * Returns true if the input looks like an ENS name, with or without a scheme
 * (e.g. "vitalik.eth" or "https://vitalik.eth").
 */
export function isEnsName(input: string): boolean {
  return ensNameFrom(input) !== null;
}

/**
 * Converts an ENS name to its IPNS gateway URL via inbrowser.link.
 * e.g. "vitalik.eth" → "https://vitalik-eth.ipns.inbrowser.link"
 */
export function ensToUrl(input: string): string {
  const name = (ensNameFrom(input) ?? input.trim()).replace(/\./g, "-");
  return `https://${name}.ipns.inbrowser.link`;
}

/**
 * The gateway hostname an ENS name resolves to — i.e. the TLS server name a
 * TLSNotary proof of the resolved page will attest.
 * e.g. "https://vitalik.eth" → "vitalik-eth.ipns.inbrowser.link"
 */
export function ensGatewayHost(input: string): string {
  return new URL(ensToUrl(input)).hostname;
}
