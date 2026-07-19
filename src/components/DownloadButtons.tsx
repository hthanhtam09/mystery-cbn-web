"use client";

import { useState } from "react";
import { ApiError, fetchArtifactBlob } from "@/lib/api";
import type { ArtifactKey } from "@/lib/api";

const DOWNLOADS: { artifact: ArtifactKey; label: string; extension: string; suffix: string }[] = [
  { artifact: "preview_lineart", label: "Download Outline", extension: "png", suffix: "-outline" },
  { artifact: "preview_colored", label: "Download Colored", extension: "png", suffix: "-colored" },
  { artifact: "preview_palette", label: "Download Palette", extension: "png", suffix: "-palette" },
];

export interface DownloadButtonsProps {
  jobId: string;
  availableArtifacts: Partial<Record<ArtifactKey, string>>;
}

export function DownloadButtons({ jobId, availableArtifacts }: DownloadButtonsProps) {
  const [error, setError] = useState<string | null>(null);

  // Fetch-then-object-URL rather than a plain cross-origin <a download>: the
  // download attribute is spec-ignored across origins unless the response
  // sends Content-Disposition: attachment, and even then behavior varies by
  // browser. A same-origin blob: URL downloads reliably everywhere.
  const handleDownload = async (artifact: ArtifactKey, extension: string, suffix: string) => {
    setError(null);
    try {
      const blob = await fetchArtifactBlob(jobId, artifact);
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `mystery-cbn-${jobId}${suffix}.${extension}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `failed to download ${artifact}`);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Download conversion results">
        {DOWNLOADS.filter((d) => d.artifact in availableArtifacts).map((d) => (
          <button
            key={d.artifact}
            type="button"
            onClick={() => void handleDownload(d.artifact, d.extension, d.suffix)}
            className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            {d.label}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
