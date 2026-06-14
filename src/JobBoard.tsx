import { useState } from "react";
import { useCurrentAccount, useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { Market, ScanJob } from "./contracts/scan_market/scan_market";
import { useScanConfig } from "./lib/config";
import { ScanGroup, type Job, type ScanGroupData } from "./ScanGroup";
import { Card, CardContent } from "./components/ui/card";

type Tab = "mine" | "all";

// Group jobs that share a requester + URL into one scan (multi-vantage posts
// create one job per vantage in a single transaction).
function groupScans(jobs: Job[]): ScanGroupData[] {
  const map = new Map<string, ScanGroupData>();
  const order: string[] = [];
  for (const job of jobs) {
    const key = `${job.requester}|${job.url}`;
    if (!map.has(key)) {
      map.set(key, { url: job.url, requester: job.requester, jobs: [] });
      order.push(key);
    }
    map.get(key)!.jobs.push(job);
  }
  return order.map((k) => map.get(k)!);
}

export function JobBoard() {
  const client = useCurrentClient();
  const account = useCurrentAccount();
  const { marketId } = useScanConfig();
  const [tab, setTab] = useState<Tab>("mine");

  const { data, isPending, error } = useQuery({
    queryKey: ["jobs", marketId],
    enabled: !!marketId,
    refetchInterval: 4000,
    queryFn: async (): Promise<Job[]> => {
      const market = await Market.get({ client, objectId: marketId! });
      const jobIds = [...market.json.jobs].reverse();
      if (jobIds.length === 0) return [];
      const jobs = await ScanJob.getMany({ client, objectIds: jobIds });
      return jobs.map((j) => ({
        id: j.json.id,
        requester: j.json.requester,
        url: j.json.url,
        params: j.json.params,
        reward_total: j.json.reward_total,
        per_scan: j.json.per_scan,
        max_submissions: j.json.max_submissions,
        approved_count: j.json.approved_count,
        pending_count: j.json.pending_count,
        submissions: j.json.submissions,
        status: j.json.status,
        cloaking_clusters: j.json.cloaking_clusters,
        cloaking_detail: j.json.cloaking_detail,
      }));
    },
  });

  if (!marketId) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-muted-foreground">
          No market configured for this network.
        </CardContent>
      </Card>
    );
  }

  const all = data ?? [];
  const mine = account
    ? all.filter((j) => j.requester === account.address)
    : [];
  const allGroups = groupScans(all);
  const myGroups = groupScans(mine);
  const shown = tab === "mine" ? myGroups : allGroups;

  return (
    <div>
      <div className="mb-3 flex items-center gap-5 border-b text-sm">
        <TabButton
          active={tab === "mine"}
          count={myGroups.length}
          onClick={() => setTab("mine")}
        >
          Your scans
        </TabButton>
        <TabButton
          active={tab === "all"}
          count={allGroups.length}
          onClick={() => setTab("all")}
        >
          All scans
        </TabButton>
      </div>

      {isPending ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Loading scans…
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="py-6 text-sm text-red-300">
            {(error as Error).message}
          </CardContent>
        </Card>
      ) : shown.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {tab === "mine"
              ? "You haven't scanned anything yet. Paste a URL above to start."
              : "No scans yet."}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {shown.map((g) => (
            <ScanGroup key={`${g.requester}|${g.url}`} group={g} />
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({
  active,
  count,
  onClick,
  children,
}: {
  active: boolean;
  count: number;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 pb-2 font-medium transition-colors ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
      <span className="text-xs text-muted-foreground">{count}</span>
    </button>
  );
}
