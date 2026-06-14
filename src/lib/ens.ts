/**
 * Returns true if the input looks like an ENS name (e.g. "vitalik.eth").
 */
export function isEnsName(input: string): boolean {
  return /^[a-zA-Z0-9-]+\.eth$/.test(input.trim());
}

/**
 * Converts an ENS name to its IPNS gateway URL via inbrowser.link.
 * e.g. "vitalik.eth" → "https://vitalik-eth.ipns.inbrowser.link"
 */
export function ensToUrl(ensName: string): string {
  const name = ensName.trim().replace(/\./g, "-");
  return `https://${name}.ipns.inbrowser.link`;
}
