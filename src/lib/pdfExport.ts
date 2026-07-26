import { jsPDF } from "jspdf";
import { fetchArtifactBlob } from "@/lib/api";
import { fetchPaletteSwatches } from "@/lib/paletteExtract";
import { JsPdfDrawer } from "@/lib/pageDrawer";
import { drawPalettePage } from "@/lib/paletteLayout";

// KDP 8.5x11in trim with 0.125in bleed on every edge, per KDP's bleed spec:
// https://kdp.amazon.com/en_US/help/topic/G201953020 — trim 215.9x279.4mm,
// bleed adds 3.175mm per edge -> full page 222.25x285.75mm.
export const IN_TO_MM = 25.4;
const TRIM_WIDTH_MM = 8.5 * IN_TO_MM;
const TRIM_HEIGHT_MM = 11 * IN_TO_MM;
const BLEED_MM = 0.125 * IN_TO_MM;
export const PAGE_WIDTH_MM = TRIM_WIDTH_MM + BLEED_MM * 2;
export const PAGE_HEIGHT_MM = TRIM_HEIGHT_MM + BLEED_MM * 2;

// KDP's minimum inner margin for a black-and-white/standard color interior
// up to 150 pages; safe default since we don't track binding side per page.
export const MARGIN_MM = 0.375 * IN_TO_MM;
const GAP_MM = 4;

const SUMMARY_COLUMNS = 2;
const SUMMARY_ROWS = 2;
const SUMMARY_PER_PAGE = SUMMARY_COLUMNS * SUMMARY_ROWS;
// Reserved below each thumbnail for its item number and caption text.
export const SUMMARY_LABEL_HEIGHT_MM = 22;
const SUMMARY_NUMBER_AREA_MM = 7;
const SUMMARY_NUMBER_PT = 20;
const SUMMARY_CAPTION_PT = 11;
const SUMMARY_CAPTION_LINE_HEIGHT_MM = SUMMARY_CAPTION_PT * 0.3528 * 1.15;

/** Strips a leading "1. "/"1) "/"1 - " style index a caption may already carry, so it isn't duplicated by the number drawn above it. */
function stripLeadingIndex(text: string): string {
  return text.replace(/^\s*\d+\s*[.):-]\s*/, "");
}

/**
 * Draws one summary-grid cell: a bordered, contained thumbnail, its item
 * number centered below it, then the caption (if any) wrapped to fit the
 * cell's width and clamped to the label area's height — truncated with an
 * ellipsis rather than overflowing into the row below or a neighboring cell.
 */
export interface SummaryCellRect {
  x: number;
  y: number;
  width: number;
  imageHeight: number;
}

export function drawSummaryCell(
  doc: jsPDF,
  img: HTMLImageElement,
  dataUrl: string,
  rect: SummaryCellRect,
  itemNumber: number,
  caption: string | undefined,
): void {
  const { x, y, width: cellWidth, imageHeight } = rect;
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.rect(x, y, cellWidth, imageHeight, "S");
  drawContained(doc, img, dataUrl, x, y, cellWidth, imageHeight);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(SUMMARY_NUMBER_PT);
  doc.setTextColor(0, 0, 0);
  doc.text(String(itemNumber), x + cellWidth / 2, y + imageHeight + SUMMARY_NUMBER_AREA_MM * 0.6, {
    align: "center",
    baseline: "middle",
  });

  const cleanCaption = caption ? stripLeadingIndex(caption).trim() : "";
  if (!cleanCaption) return;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(SUMMARY_CAPTION_PT);
  const maxWidth = cellWidth - 4;
  const availableHeight = SUMMARY_LABEL_HEIGHT_MM - SUMMARY_NUMBER_AREA_MM;
  const maxLines = Math.max(1, Math.floor(availableHeight / SUMMARY_CAPTION_LINE_HEIGHT_MM));
  const lines: string[] = doc.splitTextToSize(cleanCaption, maxWidth);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    shown[maxLines - 1] = shown[maxLines - 1].trimEnd() + "…";
  }

  const captionTop = y + imageHeight + SUMMARY_NUMBER_AREA_MM;
  shown.forEach((line, i) => {
    doc.text(
      line,
      x + cellWidth / 2,
      captionTop + i * SUMMARY_CAPTION_LINE_HEIGHT_MM + SUMMARY_CAPTION_LINE_HEIGHT_MM / 2,
      { align: "center", baseline: "middle" },
    );
  });
}

export interface PdfExportItem {
  jobId: string;
  fileName: string;
}

export interface PdfExportProgress {
  done: number;
  total: number;
}

export interface PdfExportOptions {
  /** Full-bleed pages inserted before the per-item content, in order. */
  introImages?: Blob[];
  /** Full-bleed pages inserted after the summary grid, in order. */
  outroImages?: Blob[];
  /**
   * Full-bleed background images drawn behind each item's palette page,
   * cycling by item index — e.g. 2 backgrounds across 10 items repeats each
   * one 5 times, same cycling pattern as SHAPE_CYCLE.
   */
  paletteBackgrounds?: Blob[];
  /**
   * Caption text per item, in the same order as `items`, imported from a
   * CSV (header "text", one row per item in import order). Shown under the
   * item's number on the summary page. Missing/short arrays leave later
   * items captionless.
   */
  captions?: string[];
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("failed to decode image"));
    img.src = dataUrl;
  });
}

function imageFormat(dataUrl: string): "PNG" | "JPEG" {
  return dataUrl.startsWith("data:image/png") ? "PNG" : "JPEG";
}

/** Fits `img` inside a box of the given size, centered, preserving aspect ratio. */
export function drawContained(
  doc: jsPDF,
  img: HTMLImageElement,
  dataUrl: string,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
): void {
  const scale = Math.min(boxWidth / img.width, boxHeight / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  doc.addImage(dataUrl, imageFormat(dataUrl), x + (boxWidth - w) / 2, y + (boxHeight - h) / 2, w, h);
}

/**
 * Fills a box of the given size with `img`, cropping overflow, centered.
 * Used for full-bleed pages, where the image must reach every edge with no
 * gaps rather than letterbox.
 */
export function drawCover(
  doc: jsPDF,
  img: HTMLImageElement,
  dataUrl: string,
  x: number,
  y: number,
  boxWidth: number,
  boxHeight: number,
): void {
  const scale = Math.max(boxWidth / img.width, boxHeight / img.height);
  const w = img.width * scale;
  const h = img.height * scale;
  // No compression argument passed: addImage's compression parameter is
  // opt-in (jsPDF's jpeg-compression plugin only implements "FAST"/
  // "MEDIUM"/"SLOW", not "NONE") — omitting it embeds the source bytes
  // uncompressed, which is what a print-oriented PDF wants anyway.
  doc.addImage(dataUrl, imageFormat(dataUrl), x + (boxWidth - w) / 2, y + (boxHeight - h) / 2, w, h);
}

/**
 * Builds one combined PDF for a finished batch: for each item, a dedicated
 * palette page — swatches in a single right-aligned column running top to
 * bottom inside the safe margin, each paired with a blank note box on its
 * left for the reader to write on, real colors, one shape per item cycling
 * through square/circle/hexagon/heart across the batch, code centered
 * inside each swatch — followed by a full-bleed outline artwork page, then
 * a final summary page (or pages) listing every conversion's colored
 * preview as a 5-per-row, 25-per-page grid of thumbnails.
 */
export async function addFullBleedImagePage(doc: jsPDF, blob: Blob, isFirstPage: boolean): Promise<void> {
  const dataUrl = await blobToDataUrl(blob);
  const img = await loadImage(dataUrl);
  if (!isFirstPage) doc.addPage();
  drawCover(doc, img, dataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
}

export async function generateBatchPdf(
  items: PdfExportItem[],
  onProgress?: (progress: PdfExportProgress) => void,
  options?: PdfExportOptions,
): Promise<Blob> {
  // No stream filters + high coordinate precision: this PDF is meant for
  // print (KDP), so favor maximum sharpness over file size. `filters`
  // accepts named PDF filters like "FlateEncode" or `true`, not "NONE" —
  // an empty array means "apply no filters" here.
  const doc = new jsPDF({
    unit: "mm",
    format: [PAGE_WIDTH_MM, PAGE_HEIGHT_MM],
    filters: [],
    precision: 16,
  });
  const contentWidth = PAGE_WIDTH_MM - MARGIN_MM * 2;
  const contentHeight = PAGE_HEIGHT_MM - MARGIN_MM * 2;

  const thumbnails: { dataUrl: string; img: HTMLImageElement }[] = [];

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
    const [outlineBlob, coloredBlob, swatches] = await Promise.all([
      fetchArtifactBlob(item.jobId, "preview_lineart"),
      fetchArtifactBlob(item.jobId, "preview_colored"),
      fetchPaletteSwatches(item.jobId),
    ]);
    const [outlineDataUrl, coloredDataUrl] = await Promise.all([
      blobToDataUrl(outlineBlob),
      blobToDataUrl(coloredBlob),
    ]);
    const [outlineImg, coloredImg] = await Promise.all([
      loadImage(outlineDataUrl),
      loadImage(coloredDataUrl),
    ]);

    if (index > 0 || pageStarted) doc.addPage();
    pageStarted = true;

    if (paletteBackgrounds.length > 0) {
      const bg = paletteBackgrounds[index % paletteBackgrounds.length];
      drawCover(doc, bg.img, bg.dataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
    }

    drawPalettePage(
      new JsPdfDrawer(doc),
      swatches,
      index,
      PAGE_WIDTH_MM,
      MARGIN_MM,
      contentWidth,
      contentHeight,
    );

    doc.addPage();
    drawCover(doc, outlineImg, outlineDataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);

    thumbnails.push({ dataUrl: coloredDataUrl, img: coloredImg });

    done += 1;
    onProgress?.({ done, total });
  }

  const cellWidth = (contentWidth - GAP_MM * (SUMMARY_COLUMNS - 1)) / SUMMARY_COLUMNS;
  const cellHeight = (contentHeight - GAP_MM * (SUMMARY_ROWS - 1)) / SUMMARY_ROWS;
  const imageHeight = cellHeight - SUMMARY_LABEL_HEIGHT_MM;
  const captions = options?.captions ?? [];

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

    const { dataUrl, img } = thumbnails[i];
    drawSummaryCell(doc, img, dataUrl, { x, y, width: cellWidth, imageHeight }, i + 1, captions[i]);
  }

  const outroImages = options?.outroImages ?? [];
  for (const outroBlob of outroImages) {
    await addFullBleedImagePage(doc, outroBlob, !pageStarted);
    pageStarted = true;
  }

  return doc.output("blob");
}
