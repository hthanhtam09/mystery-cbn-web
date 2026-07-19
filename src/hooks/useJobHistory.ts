"use client";

import { useCallback, useSyncExternalStore } from "react";
import { clearHistory, loadHistory, removeHistoryEntry, type HistoryEntry } from "@/lib/jobHistory";

const EMPTY_HISTORY: HistoryEntry[] = [];

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  return () => window.removeEventListener("storage", onStoreChange);
}

/** localStorage is an external store: useSyncExternalStore keeps the SSR
 * snapshot (empty, no window) and the client snapshot correctly in sync
 * without the hydration-mismatch or extra-render issues of loading it in
 * an effect (also picks up cross-tab changes via the "storage" event). */
export function useJobHistory(): {
  entries: HistoryEntry[];
  remove: (jobId: string) => void;
  clear: () => void;
} {
  const entries = useSyncExternalStore(subscribe, loadHistory, () => EMPTY_HISTORY);

  const remove = useCallback((jobId: string) => {
    removeHistoryEntry(jobId);
  }, []);

  const clear = useCallback(() => {
    clearHistory();
  }, []);

  return { entries, remove, clear };
}
