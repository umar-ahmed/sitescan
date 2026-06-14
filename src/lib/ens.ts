import { createPublicClient, http, namehash } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});

/**
 * Returns true if the input looks like an ENS name (e.g. "vitalik.eth").
 */
export function isEnsName(input: string): boolean {
  return /^[a-zA-Z0-9-]+\.eth$/.test(input.trim());
}

const contenthashAbi = [
  {
    name: "contenthash",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "bytes" }],
  },
] as const;

/**
 * Converts a contenthash string to a gateway URL.
 * Supports IPFS (e3 prefix) and IPNS (e5 prefix).
 */
function contenthashToUrl(hex: string): string | null {
  const data = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (data.length === 0) return null;

  if (data.startsWith("e301")) {
    const cidBytes = hexToBytes(data.slice(2));
    const cid = bytesToBase32(cidBytes);
    return `https://b${cid}.ipfs.dweb.link`;
  }

  if (data.startsWith("e501")) {
    const cidBytes = hexToBytes(data.slice(2));
    const cid = bytesToBase32(cidBytes);
    return `https://b${cid}.ipns.dweb.link`;
  }

  return null;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToBase32(bytes: Uint8Array): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += alphabet[(value << (5 - bits)) & 31];
  }
  return output;
}

/**
 * Resolves a URL for an ENS name via contenthash → IPFS/IPNS gateway URL.
 * Returns the URL string, or null if no record is set.
 */
export async function resolveEnsUrl(ensName: string): Promise<string | null> {
  const name = normalize(ensName.trim());

  const resolverAddress = await client.getEnsResolver({ name });
  if (!resolverAddress) return null;

  const node = namehash(name);
  try {
    const result = await client.readContract({
      address: resolverAddress,
      abi: contenthashAbi,
      functionName: "contenthash",
      args: [node],
    });
    if (result && result !== "0x") {
      return contenthashToUrl(result);
    }
  } catch {
    // Resolver doesn't support contenthash
  }

  return null;
}
