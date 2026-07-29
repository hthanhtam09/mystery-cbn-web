import { jsPDF } from "jspdf";
import JSZip from "jszip";
import {
  addFullBleedImagePage,
  blobToDataUrl,
  drawCover,
  drawSummaryCell,
  loadImage,
  MARGIN_MM,
  PAGE_HEIGHT_MM,
  PAGE_WIDTH_MM,
  parseItemNumber,
  SUMMARY_LABEL_HEIGHT_MM,
} from "@/lib/pdfExport";
import type { PdfExportOptions, PdfExportProgress } from "@/lib/pdfExport";

/** One matched outline/colored/palette triple recovered from an imported folder. */
export interface ImportedItem {
  fileName: string;
  outlineBlob: Blob;
  coloredBlob: Blob;
  paletteBlob: Blob;
}

const SUMMARY_COLUMNS = 2;
const SUMMARY_ROWS = 2;
const SUMMARY_PER_PAGE = SUMMARY_COLUMNS * SUMMARY_ROWS;
const GAP_MM = 4;

// Matches the "outline/", "colored/", "palette/" folders zipExport.ts writes,
// wherever they land inside the picked directory tree (a zip extractor may
// nest them one level under the archive's own name).
const FOLDER_NAMES = ["outline", "colored", "palette"] as const;
type FolderName = (typeof FOLDER_NAMES)[number];

function baseKey(fileName: string): string {
  return fileName.replace(/\.[^./]+$/, "");
}

/**
 * Groups a folder-picker's flat file list (each carrying `webkitRelativePath`)
 * back into outline/colored/palette triples, matched by identical basename
 * across the three folders — the same basenames `generateBatchZip` wrote.
 */
export function parseImportedFolder(files: FileList | File[]): ImportedItem[] {
  const byFolder: Record<FolderName, Map<string, File>> = {
    outline: new Map(),
    colored: new Map(),
    palette: new Map(),
  };

  for (const file of Array.from(files)) {
    const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const parts = relativePath.split("/");
    const folderName = parts.find((part): part is FolderName =>
      FOLDER_NAMES.includes(part as FolderName),
    );
    if (!folderName) continue;
    byFolder[folderName].set(baseKey(file.name), file);
  }

  const keys = Array.from(byFolder.outline.keys())
    .filter((key) => byFolder.colored.has(key) && byFolder.palette.has(key))
    .sort();

  return keys.map((key) => ({
    fileName: key,
    outlineBlob: byFolder.outline.get(key) as File,
    coloredBlob: byFolder.colored.get(key) as File,
    paletteBlob: byFolder.palette.get(key) as File,
  }));
}

/**
 * Same matching as `parseImportedFolder`, but reads directly from a `.zip`
 * file (as produced by `generateBatchZip`) without requiring the user to
 * extract it first.
 */
export async function parseImportedZip(zipFile: File): Promise<ImportedItem[]> {
  const zip = await JSZip.loadAsync(zipFile);
  const byFolder: Record<FolderName, Map<string, JSZip.JSZipObject>> = {
    outline: new Map(),
    colored: new Map(),
    palette: new Map(),
  };

  zip.forEach((relativePath, entry) => {
    if (entry.dir) return;
    const parts = relativePath.split("/");
    const folderName = parts.find((part): part is FolderName =>
      FOLDER_NAMES.includes(part as FolderName),
    );
    if (!folderName) return;
    const fileName = parts.at(-1) ?? relativePath;
    byFolder[folderName].set(baseKey(fileName), entry);
  });

  const keys = Array.from(byFolder.outline.keys())
    .filter((key) => byFolder.colored.has(key) && byFolder.palette.has(key))
    .sort();

  return Promise.all(
    keys.map(async (key) => ({
      fileName: key,
      outlineBlob: await (byFolder.outline.get(key) as JSZip.JSZipObject).async("blob"),
      coloredBlob: await (byFolder.colored.get(key) as JSZip.JSZipObject).async("blob"),
      paletteBlob: await (byFolder.palette.get(key) as JSZip.JSZipObject).async("blob"),
    })),
  );
}

/**
 * Builds the same combined PDF `generateBatchPdf` would, but from a folder
 * imported via `parseImportedFolder` instead of live conversion jobs — no
 * re-conversion needed. The only structural difference from `generateBatchPdf`
 * is the palette page: since only a rasterized palette PNG is available
 * (not the original swatch data), it's placed as a full-bleed image exactly
 * like the outline page, rather than redrawn as vector shapes.
 */
export async function generateBatchPdfFromFolder(
  items: ImportedItem[],
  onProgress?: (progress: PdfExportProgress) => void,
  options?: PdfExportOptions,
): Promise<Blob> {
  const doc = new jsPDF({
    unit: "mm",
    format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
    filters: [],
    precision: 16,
  });
  const contentWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const contentHeight = PAGE_HEIGHT_MM - MARGIN_MM * 2;

  const thumbnails: { dataUrl: string; img: HTMLImageElement; itemNumber: number }[] = [];

  let done = 0;
  const total = items.length;
  onProgress?.({ done, total });

  const introImages = options?.introImages ?? [];
  let pageStarted = false;
  for (const introBlob of introImages) {
    await addFullBleedImagePage(doc, introBlob, !pageStarted);
    pageStarted = true;
  }

  const paletteBackgrounds = await Promise.all(
    (options?.paletteBackgrounds ?? []).map(async (blob) => {
      const dataUrl = await blobToDataUrl(blob);
      const img = await loadImage(dataUrl);
      return { dataUrl, img };
    }),
  );

  for (const [index, item] of items.entries()) {
    const itemNumber = parseItemNumber(item.fileName, index + 1);
    const [outlineDataUrl, coloredDataUrl, paletteDataUrl] = await Promise.all([
      blobToDataUrl(item.outlineBlob),
      blobToDataUrl(item.coloredBlob),
      blobToDataUrl(item.paletteBlob),
    ]);
    const [outlineImg, coloredImg, paletteImg] = await Promise.all([
      loadImage(outlineDataUrl),
      loadImage(coloredDataUrl),
      loadImage(paletteDataUrl),
    ]);

    if (index > 0 || pageStarted) doc.addPage();
    pageStarted = true;

    if (paletteBackgrounds.length > 0) {
      const bg = paletteBackgrounds[index % paletteBackgrounds.length];
      drawCover(doc, bg.img, bg.dataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
    }
    drawCover(doc, paletteImg, paletteDataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);

    doc.addPage();
    drawCover(doc, outlineImg, outlineDataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);

    thumbnails.push({ dataUrl: coloredDataUrl, img: coloredImg, itemNumber });

    done += 1;
    onProgress?.({ done, total });
  }

  const cellWidth = (contentWidth - GAP_MM * (SUMMARY_COLUMNS - 1)) / SUMMARY_COLUMNS;
  const cellHeight = (contentHeight - GAP_MM * (SUMMARY_ROWS - 1)) / SUMMARY_ROWS;
  const imageHeight = cellHeight - SUMMARY_LABEL_HEIGHT_MM;

  for (let i = 0; i < thumbnails.length; i += 1) {
    const posOnPage = i % SUMMARY_PER_PAGE;
    if (posOnPage === 0) {
      if (pageStarted) doc.addPage();
      pageStarted = true;
    }
    const col = posOnPage % SUMMARY_COLUMNS;
    const row = Math.floor(posOnPage / SUMMARY_COLUMNS);
    const x = MARGIN_MM + col * (cellWidth + GAP_MM);
    const y = MARGIN_MM + row * (cellHeight + GAP_MM);

    const { dataUrl, img, itemNumber } = thumbnails[i];
    drawSummaryCell(
      doc,
      img,
      dataUrl,
      { x, y, width: cellWidth, imageHeight },
      itemNumber,
      options?.artworkNames?.get(itemNumber)?.text,
    );
  }

  const outroImages = options?.outroImages ?? [];
  for (const outroBlob of outroImages) {
    await addFullBleedImagePage(doc, outroBlob, !pageStarted);
    pageStarted = true;
  }

  return doc.output("blob");
}
