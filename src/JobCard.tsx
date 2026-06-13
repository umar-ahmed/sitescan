import {
  useCurrentAccount,
  useCurrentClient,
  useDAppKit,
} from "@mysten/dapp-kit-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Transaction } from "@mysten/sui/transactions";
import { cancelJob } from "./contracts/scan_market/scan_market";
import { mistToSui, useScanConfig } from "./lib/config";
import { walrusAggregatorUrl } from "./lib/walrus";
import { useCreVerdicts, verdictForJob } from "./lib/useCreVerdicts";
import type { JobVerdict, VerdictStatus } from "./lib/vetting";
import { Button } from "./components/ui/button";
import { Card, CardContent } from "./components/ui/card";
import { Globe, CheckCircle2, XCircle, Loader2, ShieldCheck, ShieldX } from "lucide-react";

export interface Submission {
  worker: string;
  screenshot_blob_id: string;
  html_blob_id: string;
  paid: string | number | bigint;
}

export interface Job {
  id: string;
  requester: string;
  url: string;
  params: string;
  reward_total: string | number | bigint;
  max_submissions: string | number | bigint;
  submissions: Submission[];
  status: number;
}

const STATUS_OPEN = 0;
const STATUS_COMPLETED = 1;

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
  const filled = job.submissions.length;
  const wanted = Number(job.max_submissions);

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
            <StatusBadge status={job.status} filled={filled} wanted={wanted} />
            <CreVerdictBadge verdict={creVerdict} hasSubmissions={filled > 0} />
          </div>
        </div>

        {creVerdict?.cloakingDelta && filled > 1 && (
          <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
            Cloaking delta: {creVerdict.cloakingDelta.detail}
          </div>
        )}

        {creVerdict?.status === "REJECTED_POLICY" && (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
            {creVerdict.reason}
          </div>
        )}

        {filled > 0 && (
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

        {job.status === STATUS_OPEN && filled < wanted && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            waiting for scanner nodes ({filled}/{wanted})
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

        {cancelMutation.error && (
          <div className="text-xs text-red-700">
            {(cancelMutation.error as Error).message}
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
        <div className="tabular-nums">
          earned {mistToSui(BigInt(submission.paid))} SUI
        </div>
        {submissionVerdict && (
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
  filled,
  wanted,
}: {
  status: number;
  filled: number;
  wanted: number;
}) {
  if (status === STATUS_COMPLETED) {
    return (
      <span className="inline-flex items-center gap-1 text-xs text-green-700">
        <CheckCircle2 className="h-3 w-3" /> {filled}/{wanted} done
      </span>
    );
  }
  if (status === STATUS_OPEN) {
    return (
      <span className="text-xs text-blue-700">
        open · {filled}/{wanted}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <XCircle className="h-3 w-3" /> cancelled
    </span>
  );
}
