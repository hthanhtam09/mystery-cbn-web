"use client";

import { useCallback, useRef, useState } from "react";
import { generateBatchPdf } from "@/lib/pdfExport";
import type { PdfExportItem, PdfExportProgress } from "@/lib/pdfExport";

export interface UseGeneratePdfResult {
  generating: boolean;
  progress: PdfExportProgress | null;
  error: string | null;
  generate: (items: PdfExportItem[]) => Promise<void>;
}

/**
 * Builds and downloads a single combined PDF from a finished batch's outline
 * and palette previews. Superseded runs (a new generate() call, or the
 * consuming component unmounting) are dropped via a generation counter, same
 * pattern as useBatchConvert.
 */
export function useGeneratePdf(): UseGeneratePdfResult {
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
      const blob = await generateBatchPdf(items, (p) => {
        if (generationRef.current === generation) setProgress(p);
      });
      if (generationRef.current !== generation) return;

      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = `mystery-cbn-batch-${Date.now()}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch (err) {
      if (generationRef.current !== generation) return;
      setError(err instanceof Error ? err.message : "failed to generate PDF");
    } finally {
      if (generationRef.current === generation) setGenerating(false);
    }
  }, []);

  return { generating, progress, error, generate };
}
