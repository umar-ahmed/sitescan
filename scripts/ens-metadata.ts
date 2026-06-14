import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import { isEnsName } from "../src/lib/ens";

const client = createPublicClient({
  chain: mainnet,
  transport: http("https://ethereum-rpc.publicnode.com"),
});

const TEXT_KEYS = [
  "description",
  "avatar",
  "url",
  "com.twitter",
  "com.github",
  "com.discord",
  "email",
  "notice",
] as const;

export interface EnsMetadata {
  name: string;
  resolvedAt: string;
  records: Partial<Record<(typeof TEXT_KEYS)[number], string>>;
}

/**
 * Fetches ENS text records for a name.
 * Returns null if the input is not an ENS name or no records are found.
 */
export async function fetchEnsMetadata(
  input: string,
): Promise<EnsMetadata | null> {
  if (!isEnsName(input)) return null;

  const name = normalize(input.trim());
  const records: Partial<Record<(typeof TEXT_KEYS)[number], string>> = {};

  const results = await Promise.allSettled(
    TEXT_KEYS.map((key) => client.getEnsText({ name, key })),
  );

  for (let i = 0; i < TEXT_KEYS.length; i++) {
    const result = results[i];
    if (result.status === "fulfilled" && result.value) {
      records[TEXT_KEYS[i]] = result.value;
    }
  }

  if (Object.keys(records).length === 0) return null;

  return {
    name: input.trim(),
    resolvedAt: new Date().toISOString(),
    records,
  };
}
