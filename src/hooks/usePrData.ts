import { useEffect } from "react";
import { getCheckRuns, getPrDetail } from "../api";
import { usePrStore } from "../stores/prStore";

const PR_POLL_INTERVAL_MS = 30_000;

export function usePrData(
  worktreeId: string,
  repoPath: string,
  prNumber: number,
  ref: string,
) {
  const setCheckRuns = usePrStore((s) => s.setCheckRuns);
  const setPrDetail = usePrStore((s) => s.setPrDetail);

  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      const [runsResult, detailResult] = await Promise.allSettled([
        getCheckRuns(repoPath, ref),
        getPrDetail(repoPath, prNumber),
      ]);

      if (cancelled) return;

      if (runsResult.status === "fulfilled") {
        setCheckRuns(worktreeId, runsResult.value);
      } else {
        console.warn("[usePrData] getCheckRuns failed:", runsResult.reason);
      }

      if (detailResult.status === "fulfilled") {
        setPrDetail(worktreeId, detailResult.value);
      } else {
        console.warn("[usePrData] getPrDetail failed:", detailResult.reason);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, PR_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [worktreeId, repoPath, prNumber, ref, setCheckRuns, setPrDetail]);
}
