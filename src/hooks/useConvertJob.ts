"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, cancelJob, getJobStatus, submitConvert } from "@/lib/api";
import type { JobStatusResponse } from "@/lib/api";
import { addHistoryEntry, updateHistoryState } from "@/lib/jobHistory";

const POLL_INTERVAL_MS = 1000;

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

// Fixed conversion settings: every job runs the commercial "mystery" style
// via the engine's "dense" preset — no user-facing choice, so upload is the
// only step. All tuning (organic full-page tiling, split_large off, cell
// density) lives in the engine preset (mystery-cbn config_defaults.py), not
// in frontend overrides.
const FIXED_PRESET = "dense";

export interface ConvertJobState {
  status: JobStatusResponse | null;
  submitting: boolean;
  submitError: string | null;
}

export interface UseConvertJobResult extends ConvertJobState {
  submit: (file: File) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
}

/** Submits a conversion, then polls GET /v1/jobs/{id} until a terminal state. */
export function useConvertJob(): UseConvertJobResult {
  const [state, setState] = useState<ConvertJobState>({
    status: null,
    submitting: false,
    submitError: null,
  });
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeJobId = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearTimeout(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const poll = useCallback(
    (jobId: string) => {
      const tick = async (): Promise<void> => {
        if (activeJobId.current !== jobId) return; // superseded by a newer job
        try {
          const status = await getJobStatus(jobId);
          if (activeJobId.current !== jobId) return;
          setState((prev) => ({ ...prev, status }));
          updateHistoryState(jobId, status.state);
          if (!TERMINAL_STATES.has(status.state)) {
            pollTimer.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
          }
        } catch (err) {
          if (activeJobId.current !== jobId) return;
          const message = err instanceof ApiError ? err.message : "lost connection to the API";
          setState((prev) => ({ ...prev, submitError: message }));
        }
      };
      void tick();
    },
    [],
  );

  const submit = useCallback(
    async (file: File) => {
      stopPolling();
      setState({ status: null, submitting: true, submitError: null });
      try {
        const { job_id } = await submitConvert({
          file,
          preset: FIXED_PRESET,
        });
        activeJobId.current = job_id;
        addHistoryEntry({
          jobId: job_id,
          fileName: file.name,
          preset: FIXED_PRESET,
          submittedAt: new Date().toISOString(),
          lastKnownState: "pending",
        });
        setState({
          status: {
            job_id,
            state: "pending",
            fraction_complete: 0,
            current_stage: null,
            error: null,
            error_type: null,
            downloads: null,
          },
          submitting: false,
          submitError: null,
        });
        poll(job_id);
      } catch (err) {
        const message = err instanceof ApiError ? err.message : "failed to submit the conversion";
        setState({ status: null, submitting: false, submitError: message });
      }
    },
    [poll, stopPolling],
  );

  const cancel = useCallback(async () => {
    const jobId = activeJobId.current;
    if (jobId === null) return;
    try {
      await cancelJob(jobId);
    } catch {
      // best-effort: the next poll tick will reflect the true server state regardless
    }
  }, []);

  const reset = useCallback(() => {
    stopPolling();
    activeJobId.current = null;
    setState({ status: null, submitting: false, submitError: null });
  }, [stopPolling]);

  return { ...state, submit, cancel, reset };
}
