"use client";

import { useCallback, useState } from "react";
import { downloadUrl } from "@/lib/api";

const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const DEFAULT_ZOOM_INDEX = 3; // 1x

export interface PreviewViewerProps {
  jobId: string;
}

type PreviewKind = "preview_lineart" | "preview_solved";

export function PreviewViewer({ jobId }: PreviewViewerProps) {
  const [kind, setKind] = useState<PreviewKind>("preview_solved");
  const [zoomIndex, setZoomIndex] = useState(DEFAULT_ZOOM_INDEX);
  const zoom = ZOOM_STEPS[zoomIndex];

  const zoomIn = useCallback(() => setZoomIndex((i) => Math.min(i + 1, ZOOM_STEPS.length - 1)), []);
  const zoomOut = useCallback(() => setZoomIndex((i) => Math.max(i - 1, 0)), []);
  const resetZoom = useCallback(() => setZoomIndex(DEFAULT_ZOOM_INDEX), []);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-border p-1" role="tablist" aria-label="Preview variant">
          <button
            type="button"
            role="tab"
            aria-selected={kind === "preview_lineart"}
            onClick={() => setKind("preview_lineart")}
            className={`rounded px-3 py-1 text-sm ${kind === "preview_lineart" ? "bg-accent text-white" : "hover:bg-surface"}`}
          >
            Line art
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={kind === "preview_solved"}
            onClick={() => setKind("preview_solved")}
            className={`rounded px-3 py-1 text-sm ${kind === "preview_solved" ? "bg-accent text-white" : "hover:bg-surface"}`}
          >
            Solved
          </button>
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Zoom controls">
          <button
            type="button"
            onClick={zoomOut}
            disabled={zoomIndex === 0}
            aria-label="Zoom out"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
          >
            −
          </button>
          <button
            type="button"
            onClick={resetZoom}
            className="min-w-14 rounded border border-border px-2 py-1 text-xs tabular-nums"
            aria-label="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={zoomIn}
            disabled={zoomIndex === ZOOM_STEPS.length - 1}
            aria-label="Zoom in"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface">
        <div className="flex min-h-full min-w-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, dynamically-sized API-served image; next/image's optimizer doesn't apply */}
          <img
            src={downloadUrl(jobId, kind)}
            alt={kind === "preview_lineart" ? "Line-art preview of the conversion" : "Solved (colored) preview of the conversion"}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            className="transition-[width] duration-150"
          />
        </div>
      </div>
    </div>
  );
}
