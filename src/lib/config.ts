import { useCurrentNetwork } from "@mysten/dapp-kit-react";
import {
  TESTNET_SCAN_MARKET_PACKAGE_ID,
  TESTNET_MARKET_ID,
  DEVNET_SCAN_MARKET_PACKAGE_ID,
  DEVNET_MARKET_ID,
  MAINNET_SCAN_MARKET_PACKAGE_ID,
  MAINNET_MARKET_ID,
} from "../constants";

const CONFIG: Record<string, { packageId?: string; marketId?: string }> = {
  testnet: {
    packageId: TESTNET_SCAN_MARKET_PACKAGE_ID,
    marketId: TESTNET_MARKET_ID,
  },
  devnet: {
    packageId: DEVNET_SCAN_MARKET_PACKAGE_ID,
    marketId: DEVNET_MARKET_ID,
  },
  mainnet: {
    packageId: MAINNET_SCAN_MARKET_PACKAGE_ID,
    marketId: MAINNET_MARKET_ID,
  },
};

export function useScanConfig() {
  const network = useCurrentNetwork();
  const cfg = CONFIG[network] ?? {};
  return { network, packageId: cfg.packageId, marketId: cfg.marketId };
}

export const MIST_PER_SUI = 1_000_000_000;

export function suiToMist(sui: number): bigint {
  return BigInt(Math.round(sui * MIST_PER_SUI));
}

export function mistToSui(mist: bigint | number | string): string {
  const value = typeof mist === "bigint" ? mist : BigInt(mist);
  const whole = value / BigInt(MIST_PER_SUI);
  const frac = value % BigInt(MIST_PER_SUI);
  const fracStr = frac.toString().padStart(9, "0").replace(/0+$/, "");
  return fracStr.length > 0 ? `${whole}.${fracStr}` : whole.toString();
}
