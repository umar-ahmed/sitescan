import { useQuery } from "@tanstack/react-query";
import type { JobVerdict, VerdictStore } from "./vetting";

const EMPTY: VerdictStore = {
  updatedAt: 0,
  verifier: "terminal-c",
  jobs: {},
};

export function useCreVerdicts() {
  const { data } = useQuery({
    queryKey: ["cre-verdicts"],
    queryFn: async (): Promise<VerdictStore> => {
      const res = await fetch("/cre-verdicts.json", { cache: "no-store" });
      if (!res.ok) return EMPTY;
      return res.json();
    },
    refetchInterval: 4000,
    staleTime: 2000,
  });

  return data ?? EMPTY;
}

export function verdictForJob(
  store: VerdictStore,
  jobId: string,
): JobVerdict | undefined {
  return store.jobs[jobId];
}
