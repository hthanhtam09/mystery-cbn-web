import JSZip from "jszip";
import { fetchArtifactBlob } from "@/lib/api";
import { fetchPaletteSwatches } from "@/lib/paletteExtract";
import { CanvasDrawer } from "@/lib/pageDrawer";
import { drawPalettePage } from "@/lib/paletteLayout";
import { MARGIN_MM, PAGE_HEIGHT_MM, PAGE_WIDTH_MM } from "@/lib/pdfExport";
import type { PdfExportItem, PdfExportProgress } from "@/lib/pdfExport";

// Zero-padded so the extracted folders sort in the same order they'd appear
// in the generated PDF, regardless of file system default sort behavior.
function paddedIndex(index: number, total: number): string {
  const width = String(total).length;
  return String(index + 1).padStart(Math.max(width, 3), "0");
}

/** Strips characters that are awkward or unsafe inside a zip entry name. */
function sanitizeName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_");
}

/**
 * Builds a ZIP with three top-level folders — outline/, colored/, palette/
 * — one file per batch item, matching exactly what `generateBatchPdf` would
 * embed for that item: the same `preview_lineart`/`preview_colored`
 * artifacts, and a rasterized palette page using the identical layout code
 * (see paletteLayout.ts) so re-importing the folder later and generating a
 * PDF from it reproduces the original pages.
 */
export async function generateBatchZip(
  items: PdfExportItem[],
  onProgress?: (progress: PdfExportProgress) => void,
): Promise<Blob> {
  const zip = new JSZip();
  const outlineFolder = zip.folder("outline");
  const coloredFolder = zip.folder("colored");
  const paletteFolder = zip.folder("palette");
  if (!outlineFolder || !coloredFolder || !paletteFolder) {
    throw new Error("failed to create zip folders");
  }

  const contentWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const contentHeight = PAGE_HEIGHT_MM - MARGIN_MM * 2;

  let done = 0;
  const total = items.length;
  onProgress?.({ done, total });

  for (const [index, item] of items.entries()) {
    const [outlineBlob, coloredBlob, swatches] = await Promise.all([
      fetchArtifactBlob(item.jobId, "preview_lineart"),
      fetchArtifactBlob(item.jobId, "preview_colored"),
      fetchPaletteSwatches(item.jobId),
    ]);

    const drawer = new CanvasDrawer(PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
    drawPalettePage(drawer, swatches, index, PAGE_WIDTH_MM, MARGIN_MM, contentWidth, contentHeight);
    const paletteBlob = await drawer.toBlob();

    const base = `${paddedIndex(index, total)}_${sanitizeName(item.fileName.replace(/\.[^./]+$/, ""))}`;
    outlineFolder.file(`${base}.png`, outlineBlob);
    coloredFolder.file(`${base}.png`, coloredBlob);
    paletteFolder.file(`${base}.png`, paletteBlob);

    done += 1;
    onProgress?.({ done, total });
  }

  return zip.generateAsync({ type: "blob" });
}
