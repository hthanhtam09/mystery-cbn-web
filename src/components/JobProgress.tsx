"use client";

import type { JobStatusResponse } from "@/lib/api";

const STATE_LABELS: Record<JobStatusResponse["state"], string> = {
  pending: "Queued",
  running: "Converting",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Cancelled",
};

export interface JobProgressProps {
  status: JobStatusResponse;
  onCancel: () => void;
}

export function JobProgress({ status, onCancel }: JobProgressProps) {
  const pct = Math.round(status.fraction_complete * 100);
  const isActive = status.state === "pending" || status.state === "running";

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{STATE_LABELS[status.state]}</span>
        {isActive && (
          <button
            type="button"
            onClick={onCancel}
            className="text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            Cancel
          </button>
        )}
      </div>

      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Conversion progress"
        className="h-2 w-full overflow-hidden rounded-full bg-surface"
      >
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${
            status.state === "failed" ? "bg-red-500" : "bg-accent"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>

      <p className="text-xs text-foreground/60" aria-live="polite">
        {status.state === "running" && status.current_stage
          ? `Stage: ${status.current_stage} (${pct}%)`
          : `${pct}%`}
      </p>

      {status.state === "failed" && status.error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {status.error_type ? `${status.error_type}: ` : ""}
          {status.error}
        </p>
      )}
    </div>
  );
}
