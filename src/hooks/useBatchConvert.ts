"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, cancelJob, getJobStatus, submitConvert } from "@/lib/api";
import type { JobStatusResponse } from "@/lib/api";

const POLL_INTERVAL_MS = 1000;
const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

// How many conversions this browser keeps in flight at once. The API's
// thread pool has 4 workers; 3 leaves headroom for other clients.
const MAX_CONCURRENT = 3;

// Fixed conversion settings: every job runs the commercial "mystery" style
// via the engine's "dense" preset — no user-facing choice, so upload is the
// only step (see useConvertJob for the full rationale).
const FIXED_PRESET = "dense";

export interface BatchItem {
  /** Local id — stable before the server assigns a job_id. */
  id: string;
  fileName: string;
  jobId: string | null;
  /** null while queued locally or while the submit request is in flight. */
  status: JobStatusResponse | null;
  /** Submit/poll failure surfaced for this item only. */
  error: string | null;
  /** True until the item is submitted to the API. */
  queued: boolean;
}

export interface UseBatchConvertResult {
  items: BatchItem[];
  /** Starts a new batch, replacing any previous one. */
  submit: (files: File[]) => void;
  /** Appends files to the current batch, leaving existing items untouched. */
  addFiles: (files: File[]) => void;
  /** Cancels one item — dequeues it locally or asks the API to cancel its job. */
  cancelItem: (id: string) => void;
  /** Clears the batch view; already-submitted jobs keep running server-side. */
  reset: () => void;
}

/**
 * Converts a batch of images: items wait in a local queue and are submitted
 * to POST /v1/convert at most MAX_CONCURRENT at a time; each submitted job
 * is polled until a terminal state, which frees the slot for the next item.
 */
export function useBatchConvert(): UseBatchConvertResult {
  const [items, setItems] = useState<BatchItem[]>([]);
  const filesRef = useRef<Map<string, File>>(new Map());
  const queueRef = useRef<string[]>([]);
  const inFlightRef = useRef(0);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const jobIdsRef = useRef<Map<string, string>>(new Map());
  // Bumped by reset(): in-flight async work from an older batch checks this
  // and bails instead of mutating the new batch's state or slot count.
  const generationRef = useRef(0);

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      generationRef.current += 1;
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, []);

  const updateItem = useCallback((id: string, patch: Partial<BatchItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }, []);

  const runItem = useCallback(
    async (id: string, generation: number) => {
      const file = filesRef.current.get(id);
      if (!file) return false;

      let jobId: string;
      try {
        const response = await submitConvert({ file, preset: FIXED_PRESET });
        jobId = response.job_id;
      } catch (err) {
        if (generationRef.current !== generation) return false;
        const message = err instanceof ApiError ? err.message : "failed to submit the conversion";
        updateItem(id, { error: message });
        return true;
      }
      if (generationRef.current !== generation) return false;

      jobIdsRef.current.set(id, jobId);
      updateItem(id, {
        jobId,
        status: {
          job_id: jobId,
          state: "pending",
          fraction_complete: 0,
          current_stage: null,
          error: null,
          error_type: null,
          downloads: null,
        },
      });

      return await new Promise<boolean>((resolve) => {
        const tick = async (): Promise<void> => {
          if (generationRef.current !== generation) {
            resolve(false);
            return;
          }
          try {
            const status = await getJobStatus(jobId);
            if (generationRef.current !== generation) {
              resolve(false);
              return;
            }
            updateItem(id, { status });
            if (TERMINAL_STATES.has(status.state)) {
              timersRef.current.delete(id);
              resolve(true);
              return;
            }
            timersRef.current.set(
              id,
              setTimeout(() => void tick(), POLL_INTERVAL_MS),
            );
          } catch (err) {
            if (generationRef.current !== generation) {
              resolve(false);
              return;
            }
            const message = err instanceof ApiError ? err.message : "lost connection to the API";
            updateItem(id, { error: message });
            timersRef.current.delete(id);
            resolve(true);
          }
        };
        void tick();
      });
    },
    [updateItem],
  );

  const pump = useCallback(() => {
    const generation = generationRef.current;
    const fillSlots = (): void => {
      while (inFlightRef.current < MAX_CONCURRENT && queueRef.current.length > 0) {
        const id = queueRef.current.shift();
        if (id === undefined) break;
        inFlightRef.current += 1;
        updateItem(id, { queued: false });
        void runItem(id, generation).then((sameGeneration) => {
          // A false result means reset() superseded this batch and already
          // zeroed the slot count — decrementing again would corrupt it.
          if (!sameGeneration || generationRef.current !== generation) return;
          inFlightRef.current -= 1;
          fillSlots();
        });
      }
    };
    fillSlots();
  }, [runItem, updateItem]);

  const submit = useCallback(
    (files: File[]) => {
      generationRef.current += 1;
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
      filesRef.current.clear();
      jobIdsRef.current.clear();
      queueRef.current = [];
      inFlightRef.current = 0;

      const next: BatchItem[] = files.map((file) => {
        const id = crypto.randomUUID();
        filesRef.current.set(id, file);
        return { id, fileName: file.name, jobId: null, status: null, error: null, queued: true };
      });
      queueRef.current = next.map((item) => item.id);
      setItems(next);
      pump();
    },
    [pump],
  );

  const addFiles = useCallback(
    (files: File[]) => {
      const next: BatchItem[] = files.map((file) => {
        const id = crypto.randomUUID();
        filesRef.current.set(id, file);
        return { id, fileName: file.name, jobId: null, status: null, error: null, queued: true };
      });
      queueRef.current.push(...next.map((item) => item.id));
      setItems((prev) => [...prev, ...next]);
      pump();
    },
    [pump],
  );

  const cancelItem = useCallback(
    (id: string) => {
      const queueIndex = queueRef.current.indexOf(id);
      if (queueIndex !== -1) {
        // Not yet submitted: just drop it from the local queue.
        queueRef.current.splice(queueIndex, 1);
        updateItem(id, { queued: false, error: "cancelled before submission" });
        return;
      }
      const jobId = jobIdsRef.current.get(id);
      if (jobId) {
        // best-effort: the next poll tick reflects the true server state
        cancelJob(jobId).catch(() => undefined);
      }
    },
    [updateItem],
  );

  const reset = useCallback(() => {
    generationRef.current += 1;
    for (const timer of timersRef.current.values()) clearTimeout(timer);
    timersRef.current.clear();
    filesRef.current.clear();
    jobIdsRef.current.clear();
    queueRef.current = [];
    inFlightRef.current = 0;
    setItems([]);
  }, []);

  return { items, submit, addFiles, cancelItem, reset };
}
