"use client";

import { useCallback, useRef, useState } from "react";
import { generateBatchZip } from "@/lib/zipExport";
import type { PdfExportItem, PdfExportProgress } from "@/lib/pdfExport";

export interface UseGenerateZipResult {
  generating: boolean;
  progress: PdfExportProgress | null;
  error: string | null;
  generate: (items: PdfExportItem[]) => Promise<void>;
}

/**
 * Builds and downloads a ZIP of a finished batch's outline/colored/palette
 * images, one folder per kind, matching exactly what `useGeneratePdf` would
 * embed for the same items. Same superseded-run guard as useGeneratePdf.
 */
export function useGenerateZip(): UseGenerateZipResult {
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<PdfExportProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generationRef = useRef(0);

  const generate = useCallback(async (items: PdfExportItem[]) => {
    const generation = ++generationRef.current;
    setGenerating(true);
    setProgress({ done: 0, total: items.length });
    setError(null);

    try {
      const blob = await generateBatchZip(items, (p) => {
        if (generationRef.current === generation) setProgress(p);
      });
      if (generationRef.current !== generation) return;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `mystery-cbn-batch-${Date.now()}.zip`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (generationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : "failed to generate ZIP");
    } finally {
      if (generationRef.current === generation) setGenerating(false);
    }
  }, []);

  return { generating, progress, error, generate };
}
