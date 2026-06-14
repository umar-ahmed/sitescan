import { useState } from "react";
import { useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { postJob } from "./contracts/scan_market/scan_market";
import { useScanConfig, suiToMist } from "./lib/config";
import { isEnsName, ensToUrl } from "./lib/ens";
import { Button } from "./components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./components/ui/card";
import { Send } from "lucide-react";

const GEOS = ["US", "DE", "BR", "IN", "NG", "JP"];
const DEVICES = ["iphone", "android", "desktop"];
const BROWSERS = ["safari", "chrome", "firefox"];

const inputClass =
  "w-full h-9 rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function PostJob() {
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const { packageId, marketId } = useScanConfig();

  const [input, setInput] = useState("https://example.com");
  const [geo, setGeo] = useState(GEOS[0]);
  const [device, setDevice] = useState(DEVICES[0]);
  const [browser, setBrowser] = useState(BROWSERS[0]);
  const [reward, setReward] = useState("0.05");
  const [scans, setScans] = useState("2");

  // The actual URL to scan: convert ENS name to gateway URL or use direct input
  const url = isEnsName(input) ? ensToUrl(input) : input;

  // Resolve ENS name when input changes
  const mutation = useMutation({
    mutationFn: async () => {
      if (!packageId || !marketId) {
        throw new Error("Contract not configured for this network");
      }
      const params = JSON.stringify({ geo, device, browser });

      const tx = new Transaction();
      const [coin] = tx.splitCoins(tx.gas, [suiToMist(Number(reward))]);
      tx.add(
        postJob({
          package: packageId,
          arguments: {
            market: marketId,
            reward: coin,
            url,
            params,
            maxSubmissions: BigInt(scans),
          },
        }),
      );

      const result = await dAppKit.signAndExecuteTransaction({
        transaction: tx,
      });
      if (result.$kind === "FailedTransaction") {
        throw new Error("Transaction failed");
      }
      await client.waitForTransaction({ result });
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (err) => console.error(err),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Send className="h-5 w-5" />
          Post a scan job
        </CardTitle>
        <CardDescription>
          Escrow a SUI reward against a URL and the victim vantage you want it
          scanned from. Any node matching the request can claim it.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <label className="text-sm font-medium">Target URL or ENS name</label>
          <input
            className={inputClass}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://... or name.eth"
          />
          {isEnsName(input) && (
            <p className="text-xs text-muted-foreground">
              Will scan: {ensToUrl(input)}
            </p>
          )}
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Geo</label>
            <select
              className={inputClass}
              value={geo}
              onChange={(e) => setGeo(e.target.value)}
            >
              {GEOS.map((g) => (
                <option key={g} value={g}>
                  {g}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Device</label>
            <select
              className={inputClass}
              value={device}
              onChange={(e) => setDevice(e.target.value)}
            >
              {DEVICES.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Browser</label>
            <select
              className={inputClass}
              value={browser}
              onChange={(e) => setBrowser(e.target.value)}
            >
              {BROWSERS.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-sm font-medium">Reward (SUI)</label>
            <input
              className={inputClass}
              type="number"
              min="0"
              step="0.01"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Scans wanted</label>
            <input
              className={inputClass}
              type="number"
              min="1"
              step="1"
              value={scans}
              onChange={(e) => setScans(e.target.value)}
            />
          </div>
        </div>

        {mutation.error && (
          <div className="p-3 rounded-md bg-red-50 border border-red-200 text-red-800 text-sm">
            {(mutation.error as Error).message}
          </div>
        )}
        {mutation.isSuccess && (
          <div className="p-3 rounded-md bg-green-50 border border-green-200 text-green-800 text-sm">
            Job posted and reward escrowed on-chain.
          </div>
        )}

        <Button
          size="lg"
          className="w-full"
          loading={mutation.isPending}
          disabled={!url || Number(reward) <= 0 || Number(scans) < 1}
          onClick={() => mutation.mutate()}
        >
          Escrow reward & post job
        </Button>
      </CardContent>
    </Card>
  );
}
