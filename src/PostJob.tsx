import { useEffect, useRef, useState } from "react";
import { useCurrentClient, useDAppKit } from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { postJob } from "./contracts/scan_market/scan_market";
import { useScanConfig, suiToMist } from "./lib/config";
import { isEnsName, ensToUrl } from "./lib/ens";
import { Button } from "./components/ui/button";
import { Search, Plus, X, ChevronDown } from "lucide-react";

const GEOS = ["US", "DE", "BR", "IN", "NG", "JP"];
const DEVICES = ["iphone", "android", "desktop"];
const BROWSERS = ["safari", "chrome", "firefox"];

interface Vantage {
  geo: string;
  device: string;
  browser: string;
}

const vKey = (v: Vantage) => `${v.geo}·${v.device}·${v.browser}`;

const PRESETS: { label: string; vantages: Vantage[] }[] = [
  {
    label: "common victims",
    vantages: [
      { geo: "BR", device: "iphone", browser: "safari" },
      { geo: "IN", device: "android", browser: "chrome" },
      { geo: "US", device: "desktop", browser: "chrome" },
    ],
  },
  {
    label: "global mobile",
    vantages: [
      { geo: "US", device: "iphone", browser: "safari" },
      { geo: "BR", device: "iphone", browser: "safari" },
      { geo: "IN", device: "android", browser: "chrome" },
      { geo: "NG", device: "android", browser: "chrome" },
    ],
  },
  {
    label: "desktop only",
    vantages: [
      { geo: "US", device: "desktop", browser: "chrome" },
      { geo: "DE", device: "desktop", browser: "firefox" },
    ],
  },
  {
    label: "North America",
    vantages: [
      { geo: "US", device: "iphone", browser: "safari" },
      { geo: "US", device: "android", browser: "chrome" },
      { geo: "US", device: "desktop", browser: "chrome" },
    ],
  },
  {
    label: "LATAM",
    vantages: [
      { geo: "BR", device: "iphone", browser: "safari" },
      { geo: "BR", device: "android", browser: "chrome" },
      { geo: "BR", device: "desktop", browser: "chrome" },
    ],
  },
  {
    label: "Europe",
    vantages: [
      { geo: "DE", device: "iphone", browser: "safari" },
      { geo: "DE", device: "android", browser: "chrome" },
      { geo: "DE", device: "desktop", browser: "firefox" },
    ],
  },
  {
    label: "APAC",
    vantages: [
      { geo: "IN", device: "android", browser: "chrome" },
      { geo: "IN", device: "iphone", browser: "safari" },
      { geo: "JP", device: "desktop", browser: "chrome" },
    ],
  },
];

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function PostJob() {
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const { packageId, marketId } = useScanConfig();

  const [url, setUrl] = useState("https://example.com");
  const [vantages, setVantages] = useState<Vantage[]>([
    { geo: "BR", device: "iphone", browser: "safari" },
    { geo: "US", device: "desktop", browser: "chrome" },
  ]);
  const [reward, setReward] = useState("0.02");
  const [showAdd, setShowAdd] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [draft, setDraft] = useState<Vantage>({
    geo: "US",
    device: "iphone",
    browser: "safari",
  });
  const presetsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPresets) return;
    const onDown = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node))
        setShowPresets(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [showPresets]);

  const total = (Number(reward) || 0) * vantages.length;

  const addVantage = () => {
    setVantages((vs) =>
      vs.some((v) => vKey(v) === vKey(draft)) ? vs : [...vs, draft],
    );
    setShowAdd(false);
  };

  const removeVantage = (key: string) =>
    setVantages((vs) => vs.filter((v) => vKey(v) !== key));

  // Resolve ENS name when input changes
  const mutation = useMutation({
    mutationFn: async () => {
      if (!packageId || !marketId) {
        throw new Error("Contract not configured for this network");
      }
      if (vantages.length === 0) throw new Error("Add at least one vantage");

      // One transaction, one job per vantage (each a single-scan slot).
      const tx = new Transaction();
      const amounts = vantages.map(() => suiToMist(Number(reward)));
      const coins = tx.splitCoins(tx.gas, amounts);
      vantages.forEach((v, i) => {
        tx.add(
          postJob({
            package: packageId,
            arguments: {
              market: marketId,
              reward: coins[i],
              url,
              params: JSON.stringify(v),
              maxSubmissions: BigInt(1),
            },
          }),
        );
      });

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

  const canScan = !!url && Number(reward) > 0 && vantages.length > 0;

  return (
    <div className="mx-auto max-w-2xl py-6 text-center">
      <h2 className="text-xl font-semibold tracking-tight">
        Scan a URL from real victim vantages
      </h2>
      <p className="mx-auto mt-1.5 max-w-xl text-sm text-muted-foreground">
        Scam sites cloak — they show different pages to different visitors. Scan
        from several vantages at once and compare what each one sees.
      </p>

      <div className="mt-6 flex items-stretch gap-2">
        <div className="flex flex-1 items-center gap-2 rounded-lg border border-input bg-background px-3 focus-within:ring-1 focus-within:ring-ring">
          <Search className="h-5 w-5 shrink-0 text-muted-foreground" />
          <input
            className="h-12 w-full bg-transparent text-base outline-none placeholder:text-muted-foreground"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://… or name.eth"
            onKeyDown={(e) => {
              if (e.key === "Enter" && canScan && !mutation.isPending) {
                mutation.mutate();
              }
            }}
          />
          {isEnsName(url) && (
            <p className="text-xs text-muted-foreground">
              Will scan: {ensToUrl(url)}
            </p>
          )}
        </div>
        <Button
          size="lg"
          className="h-12 px-6"
          loading={mutation.isPending}
          disabled={!canScan}
          onClick={() => mutation.mutate()}
        >
          Scan
        </Button>
      </div>

      <div className="mt-4 text-left">
        <div className="flex items-center justify-between">
          <span className="text-xs text-muted-foreground">
            scan from these vantages
          </span>
          <span className="text-xs text-muted-foreground">
            {vantages.length} vantage{vantages.length === 1 ? "" : "s"} ·{" "}
            {total.toFixed(2)} SUI total
          </span>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {vantages.map((v) => (
            <span
              key={vKey(v)}
              className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1.5 text-xs"
            >
              {v.geo} · {v.device} · {v.browser}
              <button
                onClick={() => removeVantage(vKey(v))}
                className="text-muted-foreground hover:text-foreground"
                aria-label="remove vantage"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            onClick={() => setShowAdd((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md border border-dashed border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            <Plus className="h-3 w-3" /> add vantage
          </button>

          <div className="relative" ref={presetsRef}>
            <button
              onClick={() => setShowPresets((s) => !s)}
              className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs hover:bg-muted"
            >
              Presets
              <ChevronDown className="h-3 w-3" />
            </button>
            {showPresets && (
              <div className="absolute left-0 z-20 mt-1 w-44 rounded-md border bg-card p-1 shadow-sm">
                {PRESETS.map((p) => (
                  <button
                    key={p.label}
                    onClick={() => {
                      setVantages(p.vantages);
                      setShowPresets(false);
                    }}
                    className="block w-full rounded px-2 py-1.5 text-left text-xs hover:bg-muted"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <button
            onClick={() => setShowAdvanced((s) => !s)}
            className="inline-flex items-center gap-1 rounded-md border border-input px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          >
            Advanced
            <ChevronDown
              className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`}
            />
          </button>
        </div>

        {showAdd && (
          <div className="mt-2 flex flex-wrap items-end gap-2 rounded-lg border bg-muted/30 p-3">
            <Picker
              label="geo"
              options={GEOS}
              value={draft.geo}
              onChange={(geo) => setDraft((d) => ({ ...d, geo }))}
            />
            <Picker
              label="device"
              options={DEVICES}
              value={draft.device}
              onChange={(device) => setDraft((d) => ({ ...d, device }))}
            />
            <Picker
              label="browser"
              options={BROWSERS}
              value={draft.browser}
              onChange={(browser) => setDraft((d) => ({ ...d, browser }))}
            />
            <Button size="sm" onClick={addVantage}>
              Add
            </Button>
          </div>
        )}

        {showAdvanced && (
          <div className="mt-2 flex items-center gap-2 rounded-md border bg-muted/30 p-3 text-xs text-muted-foreground">
            <span>reward per scan</span>
            <input
              className={`${selectClass} w-20`}
              type="number"
              min="0"
              step="0.01"
              value={reward}
              onChange={(e) => setReward(e.target.value)}
            />
            <span>SUI</span>
          </div>
        )}
      </div>

      {mutation.error && (
        <div className="mt-3 rounded-md border border-red-200 bg-red-50 p-3 text-left text-sm text-red-800">
          {(mutation.error as Error).message}
        </div>
      )}
      {mutation.isSuccess && (
        <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-3 text-left text-sm text-green-800">
          {vantages.length} scan{vantages.length === 1 ? "" : "s"} requested and
          reward escrowed on-chain.
        </div>
      )}
    </div>
  );
}

function Picker({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-muted-foreground">
        {label}
      </label>
      <select
        className={selectClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
