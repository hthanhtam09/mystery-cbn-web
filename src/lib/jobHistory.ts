import type { JobState } from "./api";

/**
 * The API has no job-listing endpoint, so history is a client-side
 * convenience: it remembers job ids this browser submitted so their status
 * can be re-polled, but the server remains the source of truth for state.
 */
export interface HistoryEntry {
  jobId: string;
  fileName: string;
  preset: string;
  submittedAt: string; // ISO timestamp
  lastKnownState: JobState;
}

const STORAGE_KEY = "mystery-cbn:job-history";
const MAX_ENTRIES = 50;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

// useSyncExternalStore requires getSnapshot to return a referentially stable
// value when the underlying data hasn't changed (else it re-renders forever).
// localStorage.getItem returns a fresh string each call, but JSON.parse-ing
// an unchanged string into a fresh array would still break that contract, so
// the parsed result is cached alongside the raw string it was derived from.
let cachedRaw: string | null = null;
let cachedEntries: HistoryEntry[] = [];

export function loadHistory(): HistoryEntry[] {
  if (!isBrowser()) return [];
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === cachedRaw) return cachedEntries;
  cachedRaw = raw;
  try {
    if (!raw) {
      cachedEntries = [];
    } else {
      const parsed = JSON.parse(raw) as unknown;
      cachedEntries = Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
    }
  } catch {
    cachedEntries = [];
  }
  return cachedEntries;
}

function saveHistory(entries: HistoryEntry[]): void {
  if (!isBrowser()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  // The native "storage" event only fires in *other* tabs; dispatch it here
  // too so same-tab subscribers (useJobHistory's useSyncExternalStore) see
  // every mutation regardless of which module in this tab made it.
  window.dispatchEvent(new Event("storage"));
}

export function addHistoryEntry(entry: HistoryEntry): HistoryEntry[] {
  const next = [entry, ...loadHistory().filter((e) => e.jobId !== entry.jobId)];
  saveHistory(next);
  return next;
}

export function updateHistoryState(jobId: string, state: JobState): HistoryEntry[] {
  const next = loadHistory().map((e) => (e.jobId === jobId ? { ...e, lastKnownState: state } : e));
  saveHistory(next);
  return next;
}

export function removeHistoryEntry(jobId: string): HistoryEntry[] {
  const next = loadHistory().filter((e) => e.jobId !== jobId);
  saveHistory(next);
  return next;
}

export function clearHistory(): void {
  saveHistory([]);
}
