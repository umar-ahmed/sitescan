import { useState } from "react";
import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import {
  cancelJob,
  reclaimRemainder,
} from "./contracts/scan_market/scan_market";
import { mistToSui, useScanConfig } from "./lib/config";
import { walrusAggregatorUrl } from "./lib/walrus";
import { useCreVerdicts, verdictForJob } from "./lib/useCreVerdicts";
import { Card } from "./components/ui/card";
import {
  Globe,
  Loader2,
  ShieldCheck,
  ShieldX,
  ChevronRight,
  AlertTriangle,
  Smartphone,
  Monitor,
  ImageOff,
} from "lucide-react";

export interface Submission {
  worker: string;
  screenshot_blob_id: string;
  html_blob_id: string;
  ens_metadata_blob_id: string;
  status: number;
  paid: string | number | bigint;
  verdict_reason: string;
  content_hash: string;
}

export interface Job {
  id: string;
  requester: string;
  url: string;
  params: string;
  reward_total: string | number | bigint;
  per_scan: string | number | bigint;
  max_submissions: string | number | bigint;
  approved_count: string | number | bigint;
  pending_count: string | number | bigint;
  submissions: Submission[];
  status: number;
  cloaking_clusters: string | number | bigint;
  cloaking_detail: string;
}

export interface ScanGroupData {
  url: string;
  requester: string;
  jobs: Job[];
}

const STATUS_OPEN = 0;
const SUB_APPROVED = 1;
const SUB_REJECTED = 2;

function parseParams(params: string): Record<string, string> {
  try {
    const parsed = JSON.parse(params);
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    // fall through to key=value parsing
  }
  const out: Record<string, string> = {};
  for (const pair of params.split(/[;,]/)) {
    const [key, ...rest] = pair.split("=");
    if (key && rest.length > 0) out[key.trim()] = rest.join("=").trim();
  }
  return out;
}

function vantageLabel(params: string): string {
  const p = parseParams(params);
  const parts = [p.geo, p.device, p.browser].filter(Boolean);
  return parts.length ? parts.join(" · ") : params || "any";
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url.replace(/^https?:\/\//, "").split("/")[0] ?? url;
  }
}

function Favicon({ url, className = "" }: { url: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  const host = hostOf(url);
  if (failed || !host)
    return <Globe className={`text-muted-foreground ${className}`} />;
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${host}&sz=64`}
      alt=""
      className={`rounded-sm ${className}`}
      onError={() => setFailed(true)}
    />
  );
}

// device → icon (mobile profiles share the phone glyph; desktop gets the monitor)
function VantageChip({ params }: { params: string }) {
  const p = parseParams(params);
  const Icon = p.device === "desktop" ? Monitor : Smartphone;
  const text =
    [p.geo, p.browser].filter(Boolean).join(" · ") || params || "any";
  return (
    <span className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5">
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

export function ScanGroup({ group }: { group: ScanGroupData }) {
  const account = useCurrentAccount();
  const [expanded, setExpanded] = useState(false);

  const isRequester = account?.address === group.requester;
  const totalReward = group.jobs.reduce(
    (sum, j) => sum + BigInt(j.reward_total),
    0n,
  );
  const vantageCount = group.jobs.length;
  const wanted = group.jobs.reduce((n, j) => n + Number(j.max_submissions), 0);
  const verified = group.jobs.reduce((n, j) => n + Number(j.approved_count), 0);

  // Cross-vantage cloaking: distinct content hashes across all submissions.
  const hashes = group.jobs
    .flatMap((j) => j.submissions.map((s) => s.content_hash))
    .filter(Boolean);
  const clusterList = [...new Set(hashes)];
  const cloaking = clusterList.length > 1;
  const clusterOf = (h: string) =>
    h ? String.fromCharCode(65 + clusterList.indexOf(h)) : null;

  return (
    <Card className="overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-muted/40"
      >
        <ChevronRight
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`}
        />
        <Favicon url={group.url} className="h-4 w-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">
            {hostOf(group.url)}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
            {group.jobs.slice(0, 4).map((j) => (
              <VantageChip key={j.id} params={j.params} />
            ))}
            {vantageCount > 4 && <span>+{vantageCount - 4}</span>}
          </div>
        </div>
        <div className="shrink-0 text-right text-xs text-muted-foreground">
          <div className="tabular-nums">
            {verified}/{wanted} verified
          </div>
          <div className="tabular-nums">{mistToSui(totalReward)} SUI</div>
        </div>
        <VerdictPill cloaking={cloaking} verified={verified} wanted={wanted} />
      </button>

      {expanded && (
        <div className="space-y-3 border-t px-4 py-3">
          <div className="truncate font-mono text-xs text-muted-foreground">
            {group.url}
          </div>

          {cloaking && (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              <span className="inline-flex items-center gap-1 font-medium">
                <AlertTriangle className="h-3 w-3" /> Possible cloaking ·{" "}
                {clusterList.length} content clusters
              </span>
              <div className="mt-0.5">
                vantages returned different pages — compare the clusters below.
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {group.jobs.map((job) => (
              <VantageBlock
                key={job.id}
                job={job}
                isRequester={isRequester}
                clusterOf={clusterOf}
              />
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}

function VerdictPill({
  cloaking,
  verified,
  wanted,
}: {
  cloaking: boolean;
  verified: number;
  wanted: number;
}) {
  if (cloaking)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800">
        <AlertTriangle className="h-3.5 w-3.5" /> cloaking
      </span>
    );
  if (verified > 0 && verified >= wanted)
    return (
      <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-medium text-emerald-800">
        <ShieldCheck className="h-3.5 w-3.5" /> consistent
      </span>
    );
  return (
    <span className="inline-flex shrink-0 items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" /> scanning
    </span>
  );
}

function VantageBlock({
  job,
  isRequester,
  clusterOf,
}: {
  job: Job;
  isRequester: boolean;
  clusterOf: (h: string) => string | null;
}) {
  const client = useCurrentClient();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const { packageId } = useScanConfig();
  const creVerdicts = useCreVerdicts();
  const creVerdict = verdictForJob(creVerdicts, job.id);

  const [imgFailed, setImgFailed] = useState(false);
  const sub = job.submissions[0];
  const imgUrl = sub ? walrusAggregatorUrl(sub.screenshot_blob_id) : null;
  const htmlUrl = sub ? walrusAggregatorUrl(sub.html_blob_id) : null;
  const cluster = sub?.content_hash ? clusterOf(sub.content_hash) : null;
  const DeviceIcon =
    parseParams(job.params).device === "desktop" ? Monitor : Smartphone;

  const runTx = async (build: (tx: Transaction) => void) => {
    if (!packageId) throw new Error("Contract not configured for this network");
    const tx = new Transaction();
    build(tx);
    const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
    if (res.$kind === "FailedTransaction")
      throw new Error("Transaction failed");
    await client.waitForTransaction({ result: res });
    return res;
  };

  const cancelMutation = useMutation({
    mutationFn: () =>
      runTx((tx) =>
        tx.add(cancelJob({ package: packageId!, arguments: { job: job.id } })),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    onError: (err) => console.error(err),
  });
  const reclaimMutation = useMutation({
    mutationFn: () =>
      runTx((tx) =>
        tx.add(
          reclaimRemainder({ package: packageId!, arguments: { job: job.id } }),
        ),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    onError: (err) => console.error(err),
  });

  return (
    <div className="overflow-hidden rounded-md border">
      <div className="relative h-28 bg-muted">
        {imgUrl && !imgFailed ? (
          <a href={imgUrl} target="_blank" rel="noreferrer">
            <img
              src={imgUrl}
              alt={`scan ${vantageLabel(job.params)}`}
              className="h-28 w-full object-cover object-top"
              onError={() => setImgFailed(true)}
            />
          </a>
        ) : imgUrl && imgFailed ? (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-muted-foreground">
            <ImageOff className="h-4 w-4" /> no preview
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            <Loader2 className="mr-1 h-3 w-3 animate-spin" /> waiting for a node
          </div>
        )}
        {cluster && (
          <span className="absolute right-1 top-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-medium text-white">
            cluster {cluster}
          </span>
        )}
      </div>

      <div className="space-y-0.5 p-2 text-xs">
        <div className="flex items-center gap-1 font-medium">
          <DeviceIcon className="h-3 w-3" />
          {vantageLabel(job.params)}
        </div>
        {sub ? (
          <SubStatus status={sub.status} paid={sub.paid} />
        ) : (
          <div className="text-amber-700">awaiting scan</div>
        )}
        {creVerdict && <CreBadge status={creVerdict.status} />}
        {sub?.content_hash && (
          <div className="break-all font-mono text-[10px] text-muted-foreground">
            {sub.content_hash.slice(0, 16)}…
          </div>
        )}
        {imgUrl && (
          <div className="flex gap-2">
            <a
              href={imgUrl}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-ring)] hover:underline"
            >
              screenshot
            </a>
            {htmlUrl && (
              <a
                href={htmlUrl}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-ring)] hover:underline"
              >
                html
              </a>
            )}
            {sub?.ens_metadata_blob_id && (
              <a
                href={walrusAggregatorUrl(sub.ens_metadata_blob_id)}
                target="_blank"
                rel="noreferrer"
                className="text-[var(--color-ring)] hover:underline"
              >
                ENS info
              </a>
            )}
          </div>
        )}
        {isRequester && job.status === STATUS_OPEN && (
          <button
            onClick={() => cancelMutation.mutate()}
            disabled={cancelMutation.isPending}
            className="text-muted-foreground hover:text-foreground"
          >
            {cancelMutation.isPending ? "cancelling…" : "cancel"}
          </button>
        )}
        {isRequester && job.status !== STATUS_OPEN && (
          <button
            onClick={() => reclaimMutation.mutate()}
            disabled={reclaimMutation.isPending}
            className="text-muted-foreground hover:text-foreground"
          >
            {reclaimMutation.isPending ? "reclaiming…" : "reclaim escrow"}
          </button>
        )}
      </div>
    </div>
  );
}

function SubStatus({
  status,
  paid,
}: {
  status: number;
  paid: string | number | bigint;
}) {
  if (status === SUB_APPROVED)
    return (
      <div className="tabular-nums text-emerald-700">
        paid {mistToSui(BigInt(paid))} SUI
      </div>
    );
  if (status === SUB_REJECTED)
    return <div className="text-red-600">rejected · not paid</div>;
  return <div className="text-amber-700">awaiting verification</div>;
}

function CreBadge({ status }: { status: string }) {
  if (status === "VERIFIED")
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <ShieldCheck className="h-3 w-3" /> verified
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-red-600">
      <ShieldX className="h-3 w-3" /> rejected
    </span>
  );
}
