import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { cancelJob, reclaimRemainder } from "./contracts/scan_market/scan_market";
import { mistToSui, useScanConfig } from "./lib/config";
import { walrusAggregatorUrl } from "./lib/walrus";
import { useCreVerdicts, verdictForJob } from "./lib/useCreVerdicts";
import type { JobVerdict, VerdictStatus } from "./lib/vetting";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Globe, CheckCircle2, XCircle, Loader2, ShieldCheck, ShieldX, Clock } from "lucide-react";

export interface Submission {
  worker: string;
  screenshot_blob_id: string;
  html_blob_id: string;
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

const STATUS_OPEN = 0;
const STATUS_COMPLETED = 1;

const SUB_PENDING = 0;
const SUB_APPROVED = 1;
const SUB_REJECTED = 2;

function short(addr: string) {
  return addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : addr;
}

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

export function JobCard({ job }: { job: Job }) {
  const client = useCurrentClient();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const queryClient = useQueryClient();
  const { packageId } = useScanConfig();
  const creVerdicts = useCreVerdicts();
  const creVerdict = verdictForJob(creVerdicts, job.id);

  const isRequester = account?.address === job.requester;
  const rewardSui = mistToSui(BigInt(job.reward_total));
  const params = parseParams(job.params);
  const attempts = job.submissions.length;
  const approved = Number(job.approved_count);
  const pending = Number(job.pending_count);
  const wanted = Number(job.max_submissions);
  const cloakingClusters = Number(job.cloaking_clusters);
  const onChainCloaking = cloakingClusters > 0 ? job.cloaking_detail : null;

  const cancelMutation = useMutation({
    mutationFn: async () => {
      if (!packageId)
        throw new Error("Contract not configured for this network");
      const tx = new Transaction();
      tx.add(cancelJob({ package: packageId, arguments: { job: job.id } }));
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res.$kind === "FailedTransaction") {
        throw new Error("Transaction failed");
      }
      await client.waitForTransaction({ result: res });
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    onError: (err) => console.error(err),
  });

  const reclaimMutation = useMutation({
    mutationFn: async () => {
      if (!packageId)
        throw new Error("Contract not configured for this network");
      const tx = new Transaction();
      tx.add(reclaimRemainder({ package: packageId, arguments: { job: job.id } }));
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res.$kind === "FailedTransaction") {
        throw new Error("Transaction failed");
      }
      await client.waitForTransaction({ result: res });
      return res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["jobs"] }),
    onError: (err) => console.error(err),
  });

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 font-medium">
              <Globe className="h-4 w-4 shrink-0" />
              <span className="truncate">{job.url}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {Object.entries(params).map(([k, v]) => (
                <span
                  key={k}
                  className="rounded bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                >
                  {k}: {v}
                </span>
              ))}
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="font-semibold tabular-nums">{rewardSui} SUI</div>
            <StatusBadge status={job.status} approved={approved} wanted={wanted} />
            <CreVerdictBadge verdict={creVerdict} hasSubmissions={attempts > 0} />
          </div>
        </div>

        {onChainCloaking ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            <span className="inline-flex items-center gap-1 font-medium">
              <ShieldCheck className="h-3 w-3" /> On-chain verdict ·{" "}
              {cloakingClusters} cluster{cloakingClusters > 1 ? "s" : ""}
            </span>
            <div className="mt-0.5">{onChainCloaking}</div>
          </div>
        ) : (
          creVerdict?.cloakingDelta &&
          attempts > 1 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Cloaking delta (off-chain): {creVerdict.cloakingDelta.detail}
            </div>
          )
        )}

        {creVerdict?.status === "REJECTED_POLICY" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {creVerdict.reason}
          </div>
        )}

        {attempts > 0 && (
          <div className="grid grid-cols-2 gap-2">
            {job.submissions.map((s, i) => (
              <SubmissionTile
                key={i}
                submission={s}
                submissionVerdict={creVerdict?.submissions[i]}
              />
            ))}
          </div>
        )}

        {job.status === STATUS_OPEN && approved + pending < wanted && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            waiting for scanner nodes ({approved} verified / {wanted}
            {pending > 0 ? ` · ${pending} pending verification` : ""})
          </div>
        )}

        {job.status === STATUS_OPEN && pending > 0 && approved + pending >= wanted && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {pending} scan{pending > 1 ? "s" : ""} awaiting verifier
          </div>
        )}

        {job.status === STATUS_OPEN && isRequester && (
          <Button
            variant="outline"
            className="w-full"
            loading={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
          >
            Cancel & refund remaining
          </Button>
        )}

        {job.status !== STATUS_OPEN && isRequester && (
          <Button
            variant="outline"
            className="w-full"
            loading={reclaimMutation.isPending}
            onClick={() => reclaimMutation.mutate()}
          >
            Reclaim leftover escrow
          </Button>
        )}

        {(cancelMutation.error || reclaimMutation.error) && (
          <div className="text-xs text-red-700">
            {((cancelMutation.error || reclaimMutation.error) as Error).message}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SubmissionTile({
  submission,
  submissionVerdict,
}: {
  submission: Submission;
  submissionVerdict?: { status: VerdictStatus; reason?: string };
}) {
  const imgUrl = walrusAggregatorUrl(submission.screenshot_blob_id);
  const htmlUrl = walrusAggregatorUrl(submission.html_blob_id);
  return (
    <div className="rounded-md border overflow-hidden">
      <a href={imgUrl} target="_blank" rel="noreferrer">
        <img
          src={imgUrl}
          alt={`scan by ${short(submission.worker)}`}
          className="w-full h-32 object-cover object-top bg-muted"
        />
      </a>
      <div className="p-2 text-xs space-y-0.5">
        <div className="text-muted-foreground">{short(submission.worker)}</div>
        <OnChainSubmissionStatus
          status={submission.status}
          paid={submission.paid}
        />
        {submission.verdict_reason && (
          <div className="text-muted-foreground" title={submission.verdict_reason}>
            “{submission.verdict_reason}”
          </div>
        )}
        {submission.content_hash && (
          <div className="font-mono text-[10px] text-muted-foreground break-all">
            hash {submission.content_hash.slice(0, 18)}…
          </div>
        )}
        {!submission.verdict_reason && submissionVerdict && (
          <CreSubmissionBadge status={submissionVerdict.status} />
        )}
        <div className="flex gap-2">
          <a
            href={imgUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 hover:underline"
          >
            screenshot
          </a>
          <a
            href={htmlUrl}
            target="_blank"
            rel="noreferrer"
            className="text-blue-700 hover:underline"
          >
            html
          </a>
        </div>
        <div className="font-mono break-all text-muted-foreground">
          {submission.screenshot_blob_id.slice(0, 16)}…
        </div>
      </div>
    </div>
  );
}

function CreVerdictBadge({
  verdict,
  hasSubmissions,
}: {
  verdict?: JobVerdict;
  hasSubmissions: boolean;
}) {
  if (!hasSubmissions) return null;
  if (!verdict) {
    return (
      <div className="mt-1 flex items-center justify-end gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        CRE pending
      </div>
    );
  }
  if (verdict.status === "VERIFIED") {
    return (
      <div className="mt-1 flex items-center justify-end gap-1 text-xs text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        CRE verified
      </div>
    );
  }
  if (verdict.status === "REJECTED_POLICY") {
    return (
      <div className="mt-1 flex items-center justify-end gap-1 text-xs text-red-700">
        <ShieldX className="h-3 w-3" />
        CRE rejected (policy)
      </div>
    );
  }
  if (verdict.status === "REJECTED_FAKE") {
    return (
      <div className="mt-1 flex items-center justify-end gap-1 text-xs text-red-700">
        <ShieldX className="h-3 w-3" />
        CRE rejected (fake evidence)
      </div>
    );
  }
  return null;
}

function OnChainSubmissionStatus({
  status,
  paid,
}: {
  status: number;
  paid: string | number | bigint;
}) {
  if (status === SUB_APPROVED) {
    return (
      <div className="tabular-nums text-emerald-700">
        paid {mistToSui(BigInt(paid))} SUI
      </div>
    );
  }
  if (status === SUB_REJECTED) {
    return <div className="text-red-700">rejected · not paid</div>;
  }
  if (status === SUB_PENDING) {
    return <div className="text-amber-700">awaiting verification</div>;
  }
  return null;
}

function CreSubmissionBadge({ status }: { status: VerdictStatus }) {
  if (status === "VERIFIED") {
    return (
      <span className="inline-flex items-center gap-1 text-emerald-700">
        <ShieldCheck className="h-3 w-3" />
        verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-red-700">
      <ShieldX className="h-3 w-3" />
      rejected
    </span>
  );
}

function StatusBadge({
  status,
  approved,
  wanted,
}: {
  status: number;
  approved: number;
  wanted: number;
}) {
  if (status === STATUS_COMPLETED) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="h-3 w-3" /> {approved}/{wanted} verified
      </span>
    );
  }
  if (status === STATUS_OPEN) {
    return (
      <span className="text-xs text-blue-700">
        open · {approved}/{wanted} verified
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <XCircle className="h-3 w-3" /> cancelled
    </span>
  );
}
