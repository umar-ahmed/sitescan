import { lazy, Suspense, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { postJob } from "./contracts/scan_market/scan_market";
import { useScanConfig, suiToMist } from "./lib/config";
import { isEnsName, ensToUrl } from "./lib/ens";
import {
  Search,
  MapPin,
  Check,
  ChevronLeft,
  Smartphone,
  Monitor,
  Radar,
  CheckCircle2,
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
  { code: "NA", name: "North America", lat: 45, lng: -100, coverage: 6 },
  { code: "LATAM", name: "Latin America", lat: -15, lng: -60, coverage: 2 },
  { code: "EU_W", name: "West Europe", lat: 48, lng: 8, coverage: 5 },
  { code: "EU_E", name: "East Europe", lat: 52, lng: 38, coverage: 2 },
  { code: "MEA", name: "Middle East & Africa", lat: 8, lng: 25, coverage: 1 },
  { code: "APAC", name: "Asia Pacific", lat: 22, lng: 100, coverage: 4 },
  { code: "OCEANIA", name: "Oceania", lat: -25, lng: 140, coverage: 0 },
];

type Step = "url" | "regions" | "device" | "review" | "launching";

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
      setLaunchDone(true);
      window.setTimeout(resetAll, 1800);
    },
    onError: (err) => {
      console.error(err);
      setStep("review");
    },
  });

  // Real launch: enter the cinematic, then sign + post on-chain.
  const startLaunch = () => {
    setLaunchDone(false);
    setStep("launching");
    launch.mutate();
  };

  // Demo: play the launch animation with no wallet and no transaction.
  const previewLaunch = () => {
    setLaunchDone(false);
    setStep("launching");
    window.setTimeout(() => setLaunchDone(true), 2200);
    window.setTimeout(resetAll, 3800);
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
                onNext={() => url && setStep("regions")}
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
                error={launch.error as Error | null}
                onBack={() => setStep("device")}
                onLaunch={startLaunch}
                onPreview={previewLaunch}
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

function StepBar({ step }: { step: Step }) {
  const steps: { id: Step; label: string }[] = [
    { id: "url", label: "URL" },
    { id: "regions", label: "Location" },
    { id: "device", label: "Devices" },
    { id: "review", label: "Launch" },
  ];
  const idx = steps.findIndex((s) => s.id === step);
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
    <div className="flex flex-1 flex-col py-4">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">
          Where should we view it from?
        </h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-white/60">
          Drag to spin the globe and click regions. The pulsing lights show
          where scanner nodes are active.
        </p>
        <div className="mt-3 flex items-center justify-center gap-4 text-xs text-white/60">
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "#3fd0a8" }}
            />
            many nodes
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "#ffb454" }}
            />
            few · slower
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              className="h-2 w-2 rounded-full"
              style={{ background: "#ff5e5e" }}
            />
            none
          </span>
        </div>
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
    <div className="pointer-events-auto py-4">
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
}: {
  device: string;
  browser: string;
  url: string;
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
        className="overflow-hidden border-[3px] border-[#1a1530] bg-card text-foreground shadow-xl shadow-black/40"
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
        <FramePage host={host} />
      </div>
    );
  }

  return (
    <div
      className="overflow-hidden border bg-card text-foreground shadow-xl shadow-black/40"
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
      <FramePage host={host} />
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
  error,
  onBack,
  onLaunch,
  onPreview,
}: {
  url: string;
  regions: RegionT[];
  profiles: Profile[];
  totalScans: number;
  total: number;
  connected: boolean;
  error: Error | null;
  onBack: () => void;
  onLaunch: () => void;
  onPreview: () => void;
}) {
  return (
    <div className="pointer-events-auto mx-auto max-w-2xl py-6">
      <div className="text-center">
        <h2 className="text-2xl font-semibold tracking-tight">Ready to scan</h2>
        <p className="mt-1 text-sm text-white/60">
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
          <button
            onClick={onPreview}
            disabled={totalScans === 0}
            className="rounded-md border border-white/25 px-4 py-2.5 text-sm text-white/80 transition hover:bg-white/10 disabled:opacity-40"
          >
            Preview animation
          </button>
          {connected ? (
            <button
              onClick={onLaunch}
              disabled={totalScans === 0}
              className="rounded-md bg-white px-8 py-2.5 text-sm font-medium text-[#0a0820] transition hover:bg-white/90 disabled:opacity-50"
            >
              Launch {totalScans} scan{totalScans === 1 ? "" : "s"}
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
            <Radar
              className="mx-auto h-14 w-14 text-white/85"
              style={{ animation: "spin 3s linear infinite" }}
            />
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
