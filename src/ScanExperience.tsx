import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { postJob, Market, ScanJob } from "./contracts/scan_market/scan_market";
import { useScanConfig, suiToMist } from "./lib/config";
import { isEnsName, ensToUrl } from "./lib/ens";
import { walrusAggregatorUrl } from "./lib/walrus";
import type { Job } from "./ScanGroup";
import {
  Search,
  MapPin,
  Check,
  ChevronLeft,
  Smartphone,
  Monitor,
  Radar,
  CheckCircle2,
  Loader2,
  ImageOff,
  ShieldAlert,
  RotateCcw,
  Play,
} from "lucide-react";

const GlobeScene = lazy(() => import("./GlobeScene"));

interface RegionT {
  code: string;
  name: string;
  lat: number;
  lng: number;
  coverage: number; // TODO: replace placeholder with live node density per region
}

const REGIONS: RegionT[] = [
  { code: "NA", name: "North America", lat: 39.04, lng: -77.49, coverage: 6 },
  { code: "LATAM", name: "Latin America", lat: -23.55, lng: -46.63, coverage: 2 },
  { code: "EU_W", name: "West Europe", lat: 50.11, lng: 8.68, coverage: 5 },
  { code: "EU_E", name: "East Europe", lat: 52.23, lng: 21.01, coverage: 2 },
  { code: "MEA", name: "Middle East & Africa", lat: 25.2, lng: 55.27, coverage: 1 },
  { code: "APAC", name: "Asia Pacific", lat: 1.35, lng: 103.82, coverage: 4 },
  { code: "OCEANIA", name: "Oceania", lat: -33.87, lng: 151.21, coverage: 0 },
];

type Step = "url" | "regions" | "device" | "review" | "launching" | "results";

// The scan device axis (what Playwright actually renders). "Mac" / "Windows"
// aren't separate scans — they're a Desktop scan distinguished by the browser.
interface Device {
  id: string;
  name: string;
  browsers: string[];
}

const DEVICES: Device[] = [
  { id: "iphone", name: "iPhone", browsers: ["safari", "chrome", "firefox"] },
  { id: "android", name: "Android", browsers: ["chrome", "firefox"] },
  {
    id: "desktop",
    name: "Desktop",
    browsers: ["chrome", "firefox", "safari", "edge"],
  },
];

const ALL_BROWSERS = ["safari", "chrome", "firefox", "edge"];

const BROWSER_DOT: Record<string, string> = {
  safari: "#4aa3ff",
  chrome: "#ff6a5e",
  firefox: "#ff9a4d",
  edge: "#3fd0a8",
};

const DEVICE_LABEL: Record<string, string> = {
  iphone: "iPhone",
  android: "Android",
  desktop: "Desktop",
};

interface Profile {
  device: string;
  browser: string;
}

const REWARD_PER_SCAN = 0.02;

function browserAllowed(device: string, browser: string) {
  return DEVICES.find((d) => d.id === device)?.browsers.includes(browser);
}

export function ScanExperience() {
  const client = useCurrentClient();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const { packageId, marketId } = useScanConfig();

  const [step, setStep] = useState<Step>("url");
  const [url, setUrl] = useState("");
  const [regions, setRegions] = useState<string[]>([]);
  const [devices, setDevices] = useState<string[]>(["iphone"]);
  const [browsers, setBrowsers] = useState<string[]>(["safari"]);
  const [launchDone, setLaunchDone] = useState(false);
  const [previewMode, setPreviewMode] = useState(false);

  const selectedRegions = REGIONS.filter((r) => regions.includes(r.code));

  // Valid (device × browser) combinations — invalid pairs (e.g. Android+Safari)
  // are simply never generated.
  const profiles: Profile[] = [];
  for (const d of devices)
    for (const b of browsers)
      if (browserAllowed(d, b)) profiles.push({ device: d, browser: b });

  const totalScans = selectedRegions.length * profiles.length;
  const total = totalScans * REWARD_PER_SCAN;

  const toggle = (set: string[], v: string) =>
    set.includes(v) ? set.filter((x) => x !== v) : [...set, v];

  const toggleRegion = (code: string) => setRegions((rs) => toggle(rs, code));

  const scrimOpacity =
    step === "device"
      ? 0.72
      : step === "review"
        ? 0.55
        : step === "regions"
          ? 0.2
          : step === "launching"
            ? 0.3
            : step === "results"
              ? 0.45
              : 0;

  const HUB = { lat: 20, lng: 0 };
  const arcs =
    step === "review" || step === "launching"
      ? selectedRegions.map((r) => ({
          startLat: HUB.lat,
          startLng: HUB.lng,
          endLat: r.lat,
          endLng: r.lng,
        }))
      : [];

  const resetAll = () => {
    setStep("url");
    setUrl("");
    setRegions([]);
    setDevices(["iphone"]);
    setBrowsers(["safari"]);
    setLaunchDone(false);
    setPreviewMode(false);
  };

  const launch = useMutation({
    mutationFn: async () => {
      if (!packageId || !marketId)
        throw new Error("Contract not configured for this network");
      const tx = new Transaction();
      const jobs: { geo: string; device: string; browser: string }[] = [];
      for (const r of selectedRegions)
        for (const p of profiles)
          jobs.push({ geo: r.code, device: p.device, browser: p.browser });

      const coins = tx.splitCoins(
        tx.gas,
        jobs.map(() => suiToMist(REWARD_PER_SCAN)),
      );
      jobs.forEach((j, i) => {
        tx.add(
          postJob({
            package: packageId,
            arguments: {
              market: marketId,
              reward: coins[i],
              url,
              params: JSON.stringify(j),
              maxSubmissions: BigInt(1),
            },
          }),
        );
      });
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res.$kind === "FailedTransaction")
        throw new Error("Transaction failed");
      await client.waitForTransaction({ result: res });
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      // Tx confirmed — now play the cinematic launch, then the results wall.
      setLaunchDone(false);
      setStep("launching");
      window.setTimeout(() => setLaunchDone(true), 1500);
      window.setTimeout(() => setStep("results"), 2600);
    },
    onError: (err) => {
      console.error(err);
      setStep("review");
    },
  });

  // Real launch: sign + post on-chain first (button shows in-flight state),
  // then the cinematic plays on success. Avoids a long static "deploying"
  // beat while the wallet popup is open.
  const startLaunch = () => {
    setPreviewMode(false);
    setLaunchDone(false);
    launch.mutate();
  };

  // Demo: simulate every job filling with no wallet/transaction, then reveal the
  // results wall populated with sample captures. Seeds sensible defaults so the
  // wall is always populated even if nothing was selected yet.
  const previewLaunch = () => {
    if (!url) setUrl("https://login-verify-wallet.com");
    if (regions.length === 0) setRegions(["NA", "EU_W", "APAC"]);
    setPreviewMode(true);
    setLaunchDone(false);
    setStep("launching");
    window.setTimeout(() => setLaunchDone(true), 1500);
    window.setTimeout(() => setStep("results"), 2600);
  };

  return (
    <section className="relative min-h-[620px] overflow-hidden bg-[#0a0820] text-white">
      <Suspense
        fallback={
          <div className="absolute inset-0 grid place-items-center text-sm text-white/40">
            Loading globe…
          </div>
        }
      >
        <GlobeScene
          regions={REGIONS}
          selected={regions}
          onToggle={toggleRegion}
          interactive={step === "regions"}
          launching={step === "launching"}
          arcs={arcs}
        />
      </Suspense>

      <motion.div
        className="pointer-events-none absolute inset-0 bg-[#0a0820]"
        initial={false}
        animate={{ opacity: scrimOpacity }}
        transition={{ duration: 0.6, ease: "easeOut" }}
      />

      {/* Vignette so headings always sit on a darker backing. */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 75% 55% at 50% 40%, rgba(10,8,32,0.6) 0%, rgba(10,8,32,0.2) 45%, transparent 72%)",
        }}
      />

      {/* Hidden demo fallback: simulate all jobs filled and jump to the results wall. */}
      {step !== "launching" && step !== "results" && (
        <button
          onClick={previewLaunch}
          title="Preview results (demo)"
          aria-label="Preview results (demo)"
          className="pointer-events-auto absolute right-3 top-3 z-20 inline-flex h-6 w-6 items-center justify-center rounded-full text-white/30 transition hover:bg-white/10 hover:text-white/70"
        >
          <Play className="h-3 w-3" />
        </button>
      )}

      {/* Persistent node-density legend whenever the globe is the focus. */}
      {(step === "regions" || step === "review" || step === "launching") && (
        <GlobeLegend />
      )}

      <div className="pointer-events-none relative z-10 mx-auto flex min-h-[620px] max-w-3xl flex-col px-4 pt-5">
        <div className="pointer-events-auto self-center">
          <StepBar step={step} />
        </div>

        <AnimatePresence mode="wait">
          {step === "url" && (
            <Slide key="url">
              <UrlStep
                url={url}
                setUrl={setUrl}
                onNext={() => {
                  if (!url) return;
                  if (!/^https?:\/\//i.test(url)) setUrl("https://" + url);
                  setStep("regions");
                }}
              />
            </Slide>
          )}
          {step === "regions" && (
            <Slide key="regions">
              <RegionStep
                selected={selectedRegions}
                onBack={() => setStep("url")}
                onNext={() => regions.length > 0 && setStep("device")}
              />
            </Slide>
          )}
          {step === "device" && (
            <Slide key="device">
              <DeviceStep
                devices={devices}
                browsers={browsers}
                profiles={profiles}
                url={url}
                onToggleDevice={(d) => setDevices((s) => toggle(s, d))}
                onToggleBrowser={(b) => setBrowsers((s) => toggle(s, b))}
                onBack={() => setStep("regions")}
                onNext={() => profiles.length > 0 && setStep("review")}
              />
            </Slide>
          )}
          {step === "review" && (
            <Slide key="review">
              <ReviewStep
                url={url}
                regions={selectedRegions}
                profiles={profiles}
                totalScans={totalScans}
                total={total}
                connected={!!account}
                launching={launch.isPending}
                error={launch.error as Error | null}
                onBack={() => setStep("device")}
                onLaunch={startLaunch}
              />
            </Slide>
          )}
          {step === "launching" && (
            <Slide key="launching">
              <LaunchingView
                count={totalScans}
                regions={selectedRegions.length}
                done={launchDone}
              />
            </Slide>
          )}
          {step === "results" && (
            <Slide key="results">
              <ScanResults
                url={url}
                regions={selectedRegions}
                profiles={profiles}
                preview={previewMode}
                onNewScan={resetAll}
              />
            </Slide>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function Slide({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      className="flex flex-1 flex-col"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -14 }}
      transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}

function GlobeLegend() {
  const items = [
    { color: "#3fd0a8", label: "many nodes" },
    { color: "#ffb454", label: "few · slower" },
    { color: "#ff5e5e", label: "none" },
  ];
  return (
    <div className="pointer-events-none absolute bottom-4 left-4 z-20 flex flex-col gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/60 backdrop-blur">
      <span className="text-[10px] uppercase tracking-wide text-white/40">
        Scanner nodes
      </span>
      {items.map((it) => (
        <span key={it.label} className="inline-flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ background: it.color }}
          />
          {it.label}
        </span>
      ))}
    </div>
  );
}

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "url", label: "URL" },
    { id: "regions", label: "Location" },
    { id: "device", label: "Devices" },
    { id: "review", label: "Launch" },
  ];
  // launching/results come after the bar's last step — treat them as the
  // flow being complete so every pill stays lit instead of going dark.
  const rawIdx = steps.findIndex((s) => s.id === step);
  const idx = rawIdx === -1 ? steps.length : rawIdx;
  return (
    <div className="my-5 flex items-center justify-center gap-2">
      {steps.map((s, i) => (
        <div key={s.id} className="flex items-center gap-2">
          <span
            className={`flex items-center gap-1.5 text-xs ${i <= idx ? "text-white" : "text-white/45"}`}
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] ${
                i < idx
                  ? "bg-white text-[#0a0820]"
                  : i === idx
                    ? "border-2 border-white text-white"
                    : "border border-white/30 text-white/45"
              }`}
            >
              {i < idx ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="h-px w-6 bg-white/25" />}
        </div>
      ))}
    </div>
  );
}

function UrlStep({
  url,
  setUrl,
  onNext,
}: {
  url: string;
  setUrl: (v: string) => void;
  onNext: () => void;
}) {
  return (
    <div className="grid flex-1 place-items-center py-10 text-center">
      <div className="pointer-events-auto w-full max-w-xl">
        <h2 className="text-3xl font-semibold tracking-tight">
          Which site do you want to investigate?
        </h2>
        <p className="mx-auto mt-3 max-w-md text-sm text-white/60">
          Enter a URL or ENS name. Next you'll choose where in the world — and
          on what devices — to view it from.
        </p>
        <div className="mt-7 flex items-center gap-2 rounded-lg border border-white/20 bg-white/10 px-4 backdrop-blur focus-within:border-white/50">
          <Search className="h-5 w-5 shrink-0 text-white/60" />
          <input
            autoFocus
            className="h-14 w-full bg-transparent text-base text-white outline-none placeholder:text-white/40"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://suspicious-site.com  ·  or  name.eth"
            onKeyDown={(e) => e.key === "Enter" && onNext()}
          />
        </div>
        {isEnsName(url) && (
          <p className="mt-2 text-xs text-white/60">
            ENS name — will scan{" "}
            <span className="font-mono text-white/80">{ensToUrl(url)}</span>
          </p>
        )}
        <button
          disabled={!url}
          onClick={onNext}
          className="mt-4 rounded-lg bg-white px-8 py-3 text-sm font-medium text-[#0a0820] transition hover:bg-white/90 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function RegionStep({
  selected,
  onBack,
  onNext,
}: {
  selected: RegionT[];
  onBack: () => void;
  onNext: () => void;
}) {
  const count = selected.length;
  const noNodes = selected.filter((r) => r.coverage === 0);
  const fewNodes = selected.filter((r) => r.coverage > 0 && r.coverage <= 2);

  return (
    <div className="flex flex-1 flex-col py-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Where should we view it from?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          Drag to spin the globe and click regions. The pulsing lights show
          where scanner nodes are active.
        </p>
      </div>

      <div className="flex-1" />

      {(noNodes.length > 0 || fewNodes.length > 0) && (
        <div
          className={`pointer-events-auto mb-2 rounded-md border px-3 py-2 text-xs ${noNodes.length ? "border-red-400/30 bg-red-500/10 text-red-200" : "border-amber-400/30 bg-amber-400/10 text-amber-200"}`}
        >
          {noNodes.length > 0
            ? `No active nodes in ${noNodes.map((r) => r.name).join(", ")} yet — those scans may not complete.`
            : `Fewer nodes in ${fewNodes.map((r) => r.name).join(", ")} — those scans may take longer.`}
        </div>
      )}

      <div className="pointer-events-auto flex items-center justify-between rounded-lg border border-white/15 bg-white/10 px-4 py-3 backdrop-blur">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <span className="text-sm text-white/70">
          {count} region{count === 1 ? "" : "s"} selected
        </span>
        <button
          disabled={count === 0}
          onClick={onNext}
          className="rounded-md bg-white px-5 py-2 text-sm font-medium text-[#0a0820] transition hover:bg-white/90 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm capitalize transition-colors ${
        disabled
          ? "cursor-not-allowed border-white/10 text-white/25"
          : active
            ? "border-white/70 bg-white/15 text-white"
            : "border-white/20 text-white/70 hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function DeviceStep({
  devices,
  browsers,
  profiles,
  url,
  onToggleDevice,
  onToggleBrowser,
  onBack,
  onNext,
}: {
  devices: string[];
  browsers: string[];
  profiles: Profile[];
  url: string;
  onToggleDevice: (d: string) => void;
  onToggleBrowser: (b: string) => void;
  onBack: () => void;
  onNext: () => void;
}) {
  // a browser is reachable only if some selected device supports it
  const browserUsable = (b: string) =>
    devices.some((d) => browserAllowed(d, b));

  return (
    <div className="pointer-events-auto py-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Build the victim devices
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          Pick any devices and browsers — we build every valid combination as a
          scan target.
        </p>
      </div>

      <div className="mt-5 flex flex-col items-center gap-4">
        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-wide text-white/50">
            devices
          </span>
          {DEVICES.map((d) => {
            const Icon = d.id === "desktop" ? Monitor : Smartphone;
            return (
              <Chip
                key={d.id}
                active={devices.includes(d.id)}
                onClick={() => onToggleDevice(d.id)}
              >
                <Icon className="h-4 w-4" />
                {d.name}
              </Chip>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-2">
          <span className="mr-1 text-xs uppercase tracking-wide text-white/50">
            browsers
          </span>
          {ALL_BROWSERS.map((b) => (
            <Chip
              key={b}
              active={browsers.includes(b)}
              disabled={!browserUsable(b)}
              onClick={() => onToggleBrowser(b)}
            >
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ background: BROWSER_DOT[b] ?? "#999" }}
              />
              {b}
            </Chip>
          ))}
        </div>
      </div>

      {/* The fleet: one mock per valid device × browser combo */}
      <div className="mt-6 flex min-h-[180px] flex-wrap items-end justify-center gap-4">
        <AnimatePresence mode="popLayout">
          {profiles.length === 0 ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="self-center rounded-md border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-xs text-amber-200"
            >
              No valid combinations — e.g. Safari isn't on Android. Add Chrome /
              Firefox, or an iPhone / Desktop.
            </motion.div>
          ) : (
            profiles.map((p, i) => (
              <motion.div
                key={`${p.device}-${p.browser}`}
                layout
                initial={{ opacity: 0, y: 24, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, scale: 0.85 }}
                transition={{
                  duration: 0.32,
                  delay: i * 0.05,
                  ease: [0.22, 1, 0.36, 1],
                }}
                className="flex flex-col items-center gap-1.5"
              >
                <DeviceFrame device={p.device} browser={p.browser} url={url} />
                <span className="text-xs capitalize text-white/70">
                  {DEVICE_LABEL[p.device]} · {p.browser}
                </span>
              </motion.div>
            ))
          )}
        </AnimatePresence>
      </div>

      <div className="mx-auto mt-4 flex max-w-2xl items-center justify-between">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <span className="text-xs text-white/50">
          {profiles.length} device{profiles.length === 1 ? "" : "s"}
        </span>
        <button
          onClick={onNext}
          disabled={profiles.length === 0}
          className="rounded-md bg-white px-6 py-2 text-sm font-medium text-[#0a0820] transition hover:bg-white/90 disabled:opacity-40"
        >
          Continue
        </button>
      </div>
    </div>
  );
}

function DeviceFrame({
  device,
  browser,
  url,
  screen,
}: {
  device: string;
  browser: string;
  url: string;
  // When provided, replaces the mock page (used by the results wall to show
  // the real captured screenshot).
  screen?: ReactNode;
}) {
  const isPhone = device === "iphone" || device === "android";
  const host = url.replace(/^https?:\/\//, "").split("/")[0] || "example.com";
  const dot = BROWSER_DOT[browser] ?? "#999";
  // Desktop look follows the browser: Safari → Mac, Edge → Windows.
  const desktopStyle =
    browser === "safari" ? "mac" : browser === "edge" ? "windows" : "generic";

  const chrome = (
    <div className="flex items-center gap-1 border-b bg-muted px-1.5 py-1">
      <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
      <div className="flex-1 truncate rounded bg-card px-1.5 py-0.5 text-[8px] text-muted-foreground">
        {host}
      </div>
    </div>
  );

  if (isPhone) {
    return (
      <div
        className="flex flex-col overflow-hidden border-[3px] border-[#1a1530] bg-card text-foreground shadow-xl shadow-black/40 ring-1 ring-white/10"
        style={{ width: 116, height: 210, borderRadius: 22 }}
      >
        {device === "iphone" ? (
          <div className="flex justify-center bg-[#1a1530] py-0.5">
            <span className="h-1 w-9 rounded-full bg-white/30" />
          </div>
        ) : (
          <div className="bg-[#1a1530] py-0.5 text-center text-[7px] text-white/40">
            ⋯
          </div>
        )}
        {chrome}
        <div className="min-h-0 flex-1 overflow-hidden">
          {screen ?? <FramePage host={host} />}
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col overflow-hidden border bg-card text-foreground shadow-xl shadow-black/40 ring-1 ring-white/10"
      style={{ width: 210, height: 150, borderRadius: 8 }}
    >
      <div className="flex items-center gap-1 border-b bg-muted px-2 py-1">
        {desktopStyle === "mac" ? (
          <>
            <span className="h-2 w-2 rounded-full bg-red-400" />
            <span className="h-2 w-2 rounded-full bg-amber-400" />
            <span className="h-2 w-2 rounded-full bg-green-400" />
          </>
        ) : (
          <span className="ml-auto text-[9px] text-muted-foreground">▢ ✕</span>
        )}
      </div>
      {chrome}
      <div className="min-h-0 flex-1 overflow-hidden">
        {screen ?? <FramePage host={host} />}
      </div>
    </div>
  );
}

function FramePage({ host }: { host: string }) {
  return (
    <div className="space-y-1.5 p-2.5">
      <div className="text-[10px] font-medium">{host}</div>
      <div className="h-1.5 w-3/4 rounded bg-muted" />
      <div className="h-1.5 w-1/2 rounded bg-muted" />
      <div className="mt-2 h-6 w-2/3 rounded bg-accent" />
    </div>
  );
}

function ReviewStep({
  url,
  regions,
  profiles,
  totalScans,
  total,
  connected,
  launching,
  error,
  onBack,
  onLaunch,
}: {
  url: string;
  regions: RegionT[];
  profiles: Profile[];
  totalScans: number;
  total: number;
  connected: boolean;
  launching: boolean;
  error: Error | null;
  onBack: () => void;
  onLaunch: () => void;
}) {
  return (
    <div className="pointer-events-auto mx-auto max-w-2xl py-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to scan</h2>
        <p className="mt-2 text-sm text-white/60">
          {totalScans} scan{totalScans === 1 ? "" : "s"} of{" "}
          <span className="font-mono">{url}</span>
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-white/15 bg-white/5 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">
            Regions
          </div>
          <div className="flex flex-wrap gap-1.5">
            {regions.map((r) => (
              <span
                key={r.code}
                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs"
              >
                <MapPin className="h-3 w-3" /> {r.name}
              </span>
            ))}
          </div>
        </div>
        <div className="rounded-md border border-white/15 bg-white/5 p-3">
          <div className="mb-2 text-xs uppercase tracking-wide text-white/50">
            Devices
          </div>
          <div className="flex flex-wrap gap-1.5">
            {profiles.map((p) => (
              <span
                key={`${p.device}-${p.browser}`}
                className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-xs capitalize"
              >
                <span
                  className="h-2 w-2 rounded-full"
                  style={{ background: BROWSER_DOT[p.browser] ?? "#999" }}
                />
                {DEVICE_LABEL[p.device]} · {p.browser}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 text-sm text-white/60">
        {regions.length} region{regions.length === 1 ? "" : "s"} ×{" "}
        {profiles.length} device{profiles.length === 1 ? "" : "s"} ={" "}
        <span className="text-white">{totalScans} scans</span> ·{" "}
        {total.toFixed(2)} SUI total
      </div>

      {error && (
        <div className="mt-3 rounded-md border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">
          {error.message}
        </div>
      )}

      <div className="mt-5 flex items-center justify-between gap-3">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          {connected ? (
            <button
              onClick={onLaunch}
              disabled={totalScans === 0 || launching}
              className="inline-flex items-center gap-2 rounded-md bg-white px-8 py-2.5 text-sm font-medium text-[#0a0820] transition hover:bg-white/90 disabled:opacity-50"
            >
              {launching ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" /> Launching…
                </>
              ) : (
                <>
                  Launch {totalScans} scan{totalScans === 1 ? "" : "s"}
                </>
              )}
            </button>
          ) : (
            <ConnectButton />
          )}
        </div>
      </div>
    </div>
  );
}

function LaunchingView({
  count,
  regions,
  done,
}: {
  count: number;
  regions: number;
  done: boolean;
}) {
  return (
    <div className="grid flex-1 place-items-center py-12 text-center">
      <div className="pointer-events-auto">
        {done ? (
          <>
            <CheckCircle2 className="mx-auto h-14 w-14 text-emerald-300" />
            <div className="mt-3 text-2xl font-semibold tracking-tight">
              Scans deployed
            </div>
            <p className="mt-1 text-sm text-white/60">
              {count} scan{count === 1 ? "" : "s"} dispatched to scanner nodes.
            </p>
          </>
        ) : (
          <>
            <div className="relative mx-auto h-14 w-14">
              <span className="absolute inset-0 animate-ping rounded-full bg-white/10" />
              <Radar className="relative mx-auto h-14 w-14 animate-spin text-white/85 [animation-duration:3s]" />
            </div>
            <div className="mt-3 text-2xl font-semibold tracking-tight">
              Deploying scanners…
            </div>
            <p className="mt-1 text-sm text-white/60">
              Dispatching {count} scan{count === 1 ? "" : "s"} across {regions}{" "}
              region{regions === 1 ? "" : "s"}.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

const SUB_APPROVED = 1;
const SUB_REJECTED = 2;

function parseVantage(params: string): {
  geo?: string;
  device?: string;
  browser?: string;
} {
  try {
    const p = JSON.parse(params);
    if (p && typeof p === "object") return p;
  } catch {
    // ignore malformed params
  }
  return {};
}

function jobMatchesVantage(
  job: Job,
  region: RegionT,
  profile: Profile,
): boolean {
  const p = parseVantage(job.params);
  return (
    p.geo === region.code &&
    p.device === profile.device &&
    p.browser === profile.browser
  );
}

interface Vantage {
  region: RegionT;
  profile: Profile;
}

type ResultState = "waiting" | "pending" | "verified" | "rejected";

interface ResultModel {
  state: ResultState;
  screenshotUrl?: string; // real capture (Walrus live, or screenshot service in preview)
  capturedAt?: number;
  contentHash?: string;
  worker?: string;
}

// Live screenshot of a URL via WordPress mShots (free, no key). Used in the
// preview/demo flow so frames show the real page instead of a mock.
function previewShotUrl(url: string, width = 600): string {
  const full = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  return `https://s.wordpress.com/mshots/v1/${encodeURIComponent(full)}?w=${width}`;
}

function mockWorker(i: number): string {
  const head = (0x9a3f + i * 0x4d7).toString(16).slice(-4);
  return `0x${head}…${(i * 7 + 11).toString(16)}c2`;
}

function timeAgo(ms: number): string {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return `${s}s ago`;
  return `${Math.round(s / 60)}m ago`;
}

function ScanProgress({
  total,
  captured,
  verified,
}: {
  total: number;
  captured: number;
  verified: number;
}) {
  if (total === 0) return null;
  const capturedPct = (captured / total) * 100;
  const verifiedPct = (verified / total) * 100;
  const allCaptured = captured >= total;
  const complete = verified >= total;
  const label = complete
    ? `Scan complete — ${verified}/${total} verified`
    : allCaptured
      ? `Verifying proofs — ${verified}/${total} verified`
      : `Capturing — ${captured}/${total} nodes reported`;
  return (
    <div className="mt-3">
      <div className="mb-1.5 flex items-center gap-1.5 text-xs text-white/60">
        {complete ? (
          <CheckCircle2 className="h-3 w-3 text-emerald-300" />
        ) : (
          <Loader2 className="h-3 w-3 animate-spin" />
        )}
        <span>{label}</span>
      </div>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-white/10">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-white/30 transition-all duration-500 ease-out"
          style={{ width: `${capturedPct}%` }}
        />
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-400/80 transition-all duration-500 ease-out"
          style={{ width: `${verifiedPct}%` }}
        />
      </div>
    </div>
  );
}

function ScanResults({
  url,
  regions,
  profiles,
  preview = false,
  onNewScan,
}: {
  url: string;
  regions: RegionT[];
  profiles: Profile[];
  preview?: boolean;
  onNewScan: () => void;
}) {
  const client = useCurrentClient();
  const account = useCurrentAccount();
  const { marketId } = useScanConfig();
  // Stable base time so "captured N ago" doesn't jitter across renders.
  const [baseTime] = useState(() => Date.now());
  // Preview reveals vantages one-by-one so the progress bar visibly fills and
  // nodes "report in" (live mode fills naturally via polling).
  const [revealed, setRevealed] = useState(0);

  const { data: jobs = [] } = useQuery({
    queryKey: ["scan-results", marketId, url, account?.address],
    enabled: !preview && !!marketId && !!account,
    refetchInterval: 4000,
    queryFn: async (): Promise<Job[]> => {
      const market = await Market.get({ client, objectId: marketId! });
      const jobIds = [...market.json.jobs];
      if (jobIds.length === 0) return [];
      const all = await ScanJob.getMany({ client, objectIds: jobIds });
      return all
        .map((j) => j.json as Job)
        .filter((j) => j.requester === account!.address && j.url === url);
    },
  });

  const vantages: Vantage[] = [];
  for (const region of regions)
    for (const profile of profiles) vantages.push({ region, profile });
  const totalVantages = vantages.length;

  useEffect(() => {
    if (!preview) return;
    setRevealed(0);
    const timers: number[] = [];
    for (let i = 1; i <= totalVantages; i++)
      timers.push(window.setTimeout(() => setRevealed(i), 500 + i * 650));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [preview, totalVantages]);

  const models: ResultModel[] = vantages.map((v, i) => {
    if (preview) {
      // Reveal progressively: not-yet-reported vantages read as "waiting" so the
      // progress bar fills. All capture the same page → one content cluster.
      if (i >= revealed) return { state: "waiting" };
      return {
        state: "verified",
        screenshotUrl: previewShotUrl(url),
        capturedAt: baseTime - (i * 3 + 2) * 1000,
        contentHash: "5b8e2f10aa",
        worker: mockWorker(i),
      };
    }
    const job = jobs.find((j) => jobMatchesVantage(j, v.region, v.profile));
    const sub = job?.submissions[0];
    if (!sub) return { state: "waiting" };
    const state: ResultState =
      sub.status === SUB_APPROVED
        ? "verified"
        : sub.status === SUB_REJECTED
          ? "rejected"
          : "pending";
    return {
      state,
      screenshotUrl: sub.screenshot_blob_id
        ? walrusAggregatorUrl(sub.screenshot_blob_id)
        : undefined,
      contentHash: sub.content_hash || undefined,
      worker: sub.worker || undefined,
    };
  });

  const captured = models.filter((m) => m.state !== "waiting").length;
  const verified = models.filter((m) => m.state === "verified").length;
  const clusters = new Set(
    models.map((m) => m.contentHash).filter(Boolean),
  ).size;

  const host = url.replace(/^https?:\/\//, "").split("/")[0] || url;
  const totalSui = (vantages.length * REWARD_PER_SCAN).toFixed(2);

  return (
    <div className="pointer-events-auto mx-auto flex w-full max-w-3xl flex-1 flex-col py-4">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-white/10 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-semibold tracking-tight">
              Scan results
            </h2>
            {preview && (
              <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-white/70">
                Preview · sample data
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-white/60">
            <span className="font-mono">{host}</span> · {vantages.length} vantage
            {vantages.length === 1 ? "" : "s"} · {totalSui} SUI
          </p>
          {clusters > 1 && (
            <p className="mt-1 inline-flex items-center gap-1 text-xs text-amber-300">
              <ShieldAlert className="h-3 w-3" /> {clusters} distinct page
              versions across vantages — possible cloaking
            </p>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={onNewScan}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/25 px-3 py-2 text-sm text-white/80 transition hover:bg-white/10"
          >
            <RotateCcw className="h-3.5 w-3.5" /> New scan
          </button>
        </div>
      </div>

      <ScanProgress
        total={vantages.length}
        captured={captured}
        verified={verified}
      />

      <div className="mt-4 flex max-h-[440px] flex-wrap justify-center gap-x-5 gap-y-6 overflow-y-auto pb-2">
        {vantages.map((v, i) => (
          <ResultFrame
            key={`${v.region.code}-${v.profile.device}-${v.profile.browser}`}
            vantage={v}
            url={url}
            model={models[i]}
          />
        ))}
      </div>
    </div>
  );
}

function ResultFrame({
  vantage,
  url,
  model,
}: {
  vantage: Vantage;
  url: string;
  model: ResultModel;
}) {
  const { region, profile } = vantage;
  const [imgFailed, setImgFailed] = useState(false);
  const [disputed, setDisputed] = useState(false);
  const [reloads, setReloads] = useState(0);
  const isPhone = profile.device === "iphone" || profile.device === "android";

  // mShots serves a placeholder until the screenshot is generated; nudge a
  // couple of reloads so the real capture appears without a manual refresh.
  const isShot = model.screenshotUrl?.includes("mshots") ?? false;
  useEffect(() => {
    if (!isShot) return;
    const t1 = window.setTimeout(() => setReloads(1), 3500);
    const t2 = window.setTimeout(() => setReloads(2), 8000);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [isShot]);

  const imgSrc =
    isShot && reloads
      ? `${model.screenshotUrl}&cb=${reloads}`
      : model.screenshotUrl;

  let screen: ReactNode;
  if (model.screenshotUrl && !imgFailed) {
    screen = (
      <a
        href={model.screenshotUrl}
        target="_blank"
        rel="noreferrer"
        className="block h-full"
      >
        <img
          src={imgSrc}
          alt={`${region.name} ${profile.device} ${profile.browser}`}
          className="h-full w-full object-cover object-top"
          onError={() => setImgFailed(true)}
        />
      </a>
    );
  } else if (model.screenshotUrl && imgFailed) {
    screen = (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-muted text-[9px] text-muted-foreground">
        <ImageOff className="h-4 w-4" /> no preview
      </div>
    );
  } else {
    screen = (
      <div className="flex h-full flex-col items-center justify-center gap-1 bg-muted text-[9px] text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> awaiting a node…
      </div>
    );
  }

  const hasResult = model.state !== "waiting";

  return (
    <div
      className="flex flex-col items-center gap-2"
      style={{ width: isPhone ? 116 : 210 }}
    >
      <DeviceFrame
        device={profile.device}
        browser={profile.browser}
        url={url}
        screen={screen}
      />
      <div className="w-full text-center">
        <div className="truncate text-xs font-medium text-white">
          {region.name}
        </div>
        <div className="text-[11px] capitalize text-white/55">
          {DEVICE_LABEL[profile.device]} · {profile.browser}
        </div>
        <div className="mt-1.5 flex justify-center">
          <ResultStatus state={model.state} />
        </div>
        {model.capturedAt && (
          <div
            className="mt-1 text-[10px] text-white/45"
            title={new Date(model.capturedAt).toLocaleString()}
          >
            captured {timeAgo(model.capturedAt)}
          </div>
        )}
        {model.contentHash && (
          <div className="font-mono text-[10px] text-white/35">
            {model.contentHash.slice(0, 10)}…
          </div>
        )}
        <div className="mt-1.5 flex justify-center">
          {disputed ? (
            <span className="inline-flex items-center gap-1 rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">
              <ShieldAlert className="h-3 w-3" /> Disputed · under review
            </span>
          ) : (
            hasResult && (
              <button
                onClick={() => setDisputed(true)}
                className="inline-flex items-center gap-1 rounded border border-white/20 px-2 py-0.5 text-[11px] text-white/70 transition hover:bg-white/10"
              >
                <ShieldAlert className="h-3 w-3" /> Dispute
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function ResultStatus({ state }: { state: ResultState }) {
  if (state === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-emerald-400/15 px-2 py-0.5 text-[11px] text-emerald-200">
        <CheckCircle2 className="h-3 w-3" /> Verified
      </span>
    );
  }
  if (state === "rejected") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-400/15 px-2 py-0.5 text-[11px] text-red-200">
        <ImageOff className="h-3 w-3" /> Rejected
      </span>
    );
  }
  if (state === "pending") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-amber-400/15 px-2 py-0.5 text-[11px] text-amber-200">
        <Check className="h-3 w-3" /> Captured · pending
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-white/10 px-2 py-0.5 text-[11px] text-white/60">
      <Loader2 className="h-3 w-3 animate-spin" /> Awaiting node
    </span>
  );
}

