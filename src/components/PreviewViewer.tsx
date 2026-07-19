"use client";

import { useState } from "react";
import { useWheelZoom } from "@/hooks/useWheelZoom";
import { downloadUrl } from "@/lib/api";

export interface PreviewViewerProps {
  jobId: string;
}

type PreviewKind = "preview_lineart" | "preview_colored" | "preview_palette";

const PREVIEW_TABS: { kind: PreviewKind; label: string; alt: string }[] = [
  { kind: "preview_lineart", label: "Outline", alt: "Outline (line-art) preview of the conversion" },
  { kind: "preview_colored", label: "Colored", alt: "Colored preview: the outline with numbers, lines, and solution colors" },
  { kind: "preview_palette", label: "Palette", alt: "Numbered color palette of the conversion" },
];

export function PreviewViewer({ jobId }: Readonly<PreviewViewerProps>) {
  const [kind, setKind] = useState<PreviewKind>("preview_colored");
  const { targetRef, zoom, canZoomIn, canZoomOut, zoomIn, zoomOut, resetZoom } =
    useWheelZoom<HTMLDivElement>();

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-1 rounded-md border border-border p-1" role="tablist" aria-label="Preview variant">
          {PREVIEW_TABS.map((tab) => (
            <button
              key={tab.kind}
              type="button"
              role="tab"
              aria-selected={kind === tab.kind}
              onClick={() => setKind(tab.kind)}
              className={`rounded px-3 py-1 text-sm ${kind === tab.kind ? "bg-accent text-white" : "hover:bg-surface"}`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Zoom controls">
          <button
            type="button"
            onClick={zoomOut}
            disabled={!canZoomOut}
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
            disabled={!canZoomIn}
            aria-label="Zoom in"
            className="inline-flex h-8 w-8 items-center justify-center rounded border border-border disabled:opacity-40"
          >
            +
          </button>
        </div>
      </div>

      <div
        ref={targetRef}
        className="max-h-[70vh] overflow-auto rounded-lg border border-border bg-surface"
      >
        <div className="flex min-h-full min-w-full items-center justify-center p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- external, dynamically-sized API-served image; next/image's optimizer doesn't apply */}
          <img
            src={downloadUrl(jobId, kind)}
            alt={PREVIEW_TABS.find((t) => t.kind === kind)?.alt ?? "Preview of the conversion"}
            draggable={false}
            style={{ width: `${zoom * 100}%`, maxWidth: "none" }}
            className="select-none"
          />
        </div>
      </div>
    </div>
  );
}
