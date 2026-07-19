"use client";

import type { HistoryEntry } from "@/lib/jobHistory";

const STATE_BADGE: Record<HistoryEntry["lastKnownState"], string> = {
  pending: "bg-yellow-500/15 text-yellow-700 dark:text-yellow-400",
  running: "bg-blue-500/15 text-blue-700 dark:text-blue-400",
  succeeded: "bg-green-500/15 text-green-700 dark:text-green-400",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
  cancelled: "bg-gray-500/15 text-gray-700 dark:text-gray-400",
};

export interface JobHistoryListProps {
  entries: HistoryEntry[];
  onSelect: (jobId: string) => void;
  onRemove: (jobId: string) => void;
}

export function JobHistoryList({ entries, onSelect, onRemove }: JobHistoryListProps) {
  if (entries.length === 0) {
    return <p className="text-sm text-foreground/60">No conversions yet in this browser.</p>;
  }

  return (
    <ul className="flex flex-col gap-2">
      {entries.map((entry) => (
        <li
          key={entry.jobId}
          className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
        >
          <button
            type="button"
            onClick={() => onSelect(entry.jobId)}
            className="flex min-w-0 flex-1 flex-col items-start text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            <span className="truncate text-sm font-medium">{entry.fileName}</span>
            <span className="text-xs text-foreground/60">
              {entry.preset} · {new Date(entry.submittedAt).toLocaleString()}
            </span>
          </button>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATE_BADGE[entry.lastKnownState]}`}
          >
            {entry.lastKnownState}
          </span>
          <button
            type="button"
            onClick={() => onRemove(entry.jobId)}
            aria-label={`Remove ${entry.fileName} from history`}
            className="shrink-0 rounded p-1 text-foreground/50 hover:bg-surface hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ✕
          </button>
        </li>
      ))}
    </ul>
  );
}
