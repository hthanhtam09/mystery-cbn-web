"use client";

import { useCallback, useRef, useState } from "react";
import { generateBatchPdfFromFolder, parseImportedFolder, parseImportedZip } from "@/lib/zipImport";
import type { ImportedItem } from "@/lib/zipImport";
import type { PdfExportOptions, PdfExportProgress } from "@/lib/pdfExport";

export interface UseImportFolderResult {
  items: ImportedItem[];
  error: string | null;
  generating: boolean;
  progress: PdfExportProgress | null;
  /** Load from a folder-picker input (`webkitdirectory`), skipping conversion entirely. */
  importFromFileList: (files: FileList) => void;
  /** Load directly from a picked `.zip` file, as produced by "Export ZIP". */
  importFromZip: (zipFile: File) => Promise<void>;
  reset: () => void;
  /** Generates and downloads a PDF straight from the imported assets, no re-conversion. */
  generatePdf: (options?: PdfExportOptions) => Promise<void>;
}

/**
 * Mirrors useGeneratePdf's shape, but sources outline/colored/palette pages
 * from a previously exported folder or zip instead of live conversion jobs —
 * lets a user add intro/outro pages and export a PDF without re-running the
 * image-to-lineart conversion.
 */
export function useImportFolder(): UseImportFolderResult {
  const [items, setItems] = useState<ImportedItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState<PdfExportProgress | null>(null);
  const generationRef = useRef(0);

  const importFromFileList = useCallback((files: FileList) => {
    setError(null);
    const parsed = parseImportedFolder(files);
    if (parsed.length === 0) {
      setError("No matching outline/colored/palette triples found in the selected folder.");
      return;
    }
    setItems(parsed);
  }, []);

  const importFromZip = useCallback(async (zipFile: File) => {
    setError(null);
    try {
      const parsed = await parseImportedZip(zipFile);
      if (parsed.length === 0) {
        setError("No matching outline/colored/palette triples found in the ZIP.");
        return;
      }
      setItems(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : "failed to read ZIP");
    }
  }, []);

  const reset = useCallback(() => {
    setItems([]);
    setError(null);
    setProgress(null);
  }, []);

  const generatePdf = useCallback(
    async (options?: PdfExportOptions) => {
      const generation = ++generationRef.current;
      setGenerating(true);
      setProgress({ done: 0, total: items.length });
      setError(null);

      try {
        const blob = await generateBatchPdfFromFolder(
          items,
          (p) => {
            if (generationRef.current === generation) setProgress(p);
          },
          options,
        );
        if (generationRef.current !== generation) return;

        const objectUrl = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `mystery-cbn-import-${Date.now()}.pdf`;
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
    },
    [items],
  );

  return { items, error, generating, progress, importFromFileList, importFromZip, reset, generatePdf };
}
