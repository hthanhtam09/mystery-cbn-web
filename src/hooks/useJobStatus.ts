"use client";

import { useEffect, useState } from "react";
import { ApiError, getJobStatus } from "@/lib/api";
import type { JobStatusResponse } from "@/lib/api";
import { updateHistoryState } from "@/lib/jobHistory";

const POLL_INTERVAL_MS = 1000;
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

interface Result {
  jobId: string;
  status: JobStatusResponse | null;
  error: string | null;
}

/** Fetches and (while non-terminal) polls the status of an arbitrary job id —
 * used to resume viewing a job selected from history. */
export function useJobStatus(jobId: string | null): {
  status: JobStatusResponse | null;
  error: string | null;
} {
  const [result, setResult] = useState<Result | null>(null);

  useEffect(() => {
    if (jobId === null) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const next = await getJobStatus(jobId);
        if (cancelled) return;
        setResult({ jobId, status: next, error: null });
        updateHistoryState(jobId, next.state);
        if (!TERMINAL_STATES.has(next.state)) {
          timer = setTimeout(() => void tick(), POLL_INTERVAL_MS);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof ApiError ? err.message : "failed to load job status";
        setResult({ jobId, status: null, error: message });
      }
    };
    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [jobId]);

  // A result from a superseded jobId (in flight when jobId changed again)
  // is treated as absent rather than shown stale.
  if (jobId === null || result?.jobId !== jobId) {
    return { status: null, error: null };
  }
  return { status: result.status, error: result.error };
}
