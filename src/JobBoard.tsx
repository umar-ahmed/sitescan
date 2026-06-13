import { useCurrentClient } from "@mysten/dapp-kit-react";
import { useQuery } from "@tanstack/react-query";
import { Market, ScanJob } from "./contracts/scan_market/scan_market";
import { useScanConfig } from "./lib/config";
import { JobCard, type Job } from "./JobCard";
import { Card, CardContent } from "./components/ui/card";

export function JobBoard() {
  const client = useCurrentClient();
  const { marketId } = useScanConfig();

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
        max_submissions: j.json.max_submissions,
        submissions: j.json.submissions,
        status: j.json.status,
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

  if (isPending) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          Loading jobs…
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-red-700">
          {(error as Error).message}
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center text-muted-foreground">
          No jobs yet. Post one from the Requester tab.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((job) => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
}
