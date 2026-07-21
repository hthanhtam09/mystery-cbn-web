import { jsPDF } from "jspdf";
import { fetchArtifactBlob } from "@/lib/api";
import { fetchPaletteSwatches } from "@/lib/paletteExtract";
import type { PaletteSwatch } from "@/lib/paletteExtract";

// KDP 8.5x11in trim with 0.125in bleed on every edge, per KDP's bleed spec:
// https://kdp.amazon.com/en_US/help/topic/G201953020 — trim 215.9x279.4mm,
// bleed adds 3.175mm per edge -> full page 222.25x285.75mm.
const IN_TO_MM = 25.4;
const TRIM_WIDTH_MM = 8.5 * IN_TO_MM;
const TRIM_HEIGHT_MM = 11 * IN_TO_MM;
const BLEED_MM = 0.125 * IN_TO_MM;
const PAGE_WIDTH_MM = TRIM_WIDTH_MM + BLEED_MM * 2;
const PAGE_HEIGHT_MM = TRIM_HEIGHT_MM + BLEED_MM * 2;

// KDP's minimum inner margin for a black-and-white/standard color interior
// up to 150 pages; safe default since we don't track binding side per page.
const MARGIN_MM = 0.375 * IN_TO_MM;
const GAP_MM = 4;

const SUMMARY_COLUMNS = 5;
const SUMMARY_ROWS = 5;
const SUMMARY_PER_PAGE = SUMMARY_COLUMNS * SUMMARY_ROWS;

export interface PdfExportItem {
  jobId: string;
  fileName: string;
}

export interface PdfExportProgress {
  done: number;
  total: number;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("failed to read blob"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
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
function drawContained(
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
function drawCover(
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

const PALETTE_SWATCH_MM = 6;
const PALETTE_GAP_MM = 1;
// Larger swatch size for the palette's own dedicated page, where there's no
// outline artwork competing for space.
const PALETTE_PAGE_SWATCH_MM = 14;
// Blank note box to the left of each swatch, for the reader to write in.
const PALETTE_NOTE_WIDTH_MM = 40;
const PALETTE_NOTE_GAP_MM = 4;
const PALETTE_ROW_GAP_MM = 4;
// Horizontal gap between columns once a column fills past PALETTE_MAX_PER_COLUMN.
const PALETTE_COLUMN_GAP_MM = 6;

type SwatchShape = "square" | "circle" | "hexagon" | "heart";
const SHAPE_CYCLE: SwatchShape[] = ["square", "circle", "hexagon", "heart"];

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Draws a regular polygon (e.g. a hexagon) centered at (cx, cy). */
function drawPolygon(doc: jsPDF, cx: number, cy: number, radius: number, sides: number, rotationDeg: number): void {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  const deltas: [number, number][] = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
  const last = points.at(-1) ?? points[0];
  deltas.push([points[0][0] - last[0], points[0][1] - last[1]]);
  doc.lines(deltas, points[0][0], points[0][1], [1, 1], "FD", true);
}

/**
 * Draws an upright heart centered at (cx, cy), fit within a `size` x `size`
 * box: two round lobes at the top meeting at a center dip, tapering to one
 * point at the bottom.
 *
 * jsPDF's `lines()` path entries are deltas *from the running pen
 * position*, each either [dx,dy] (line) or [dx1,dy1,dx2,dy2,dx3,dy3] (curve:
 * two relative control points then the relative endpoint) — not absolute
 * coordinates. To avoid hand-deriving those deltas (which produced a
 * lopsided/arrow-like shape last time), every point/control point below is
 * computed as an absolute (x, y) first and converted to a delta from the
 * previous pen position right before use.
 */
function drawHeart(doc: jsPDF, cx: number, cy: number, size: number): void {
  // Scaled up to fill the size x size box the same way the other shapes
  // do (a heart's natural silhouette is narrower than its bounding square,
  // so it read visibly smaller than its neighbors at the old 0.85-0.9x
  // factors).
  const h = size / 2;
  const bottomPoint: [number, number] = [cx, cy + h * 1.05];
  const dip: [number, number] = [cx, cy - h * 0.4];
  const leftCtrl1: [number, number] = [cx - h * 1.05, cy + h * 0.25];
  const leftCtrl2: [number, number] = [cx - h * 1.15, cy - h * 0.7];
  const rightCtrl1: [number, number] = [cx + h * 1.15, cy - h * 0.7];
  const rightCtrl2: [number, number] = [cx + h * 1.05, cy + h * 0.25];

  const delta = (from: [number, number], to: [number, number]): [number, number] => [
    to[0] - from[0],
    to[1] - from[1],
  ];

  doc.lines(
    [
      [
        ...delta(bottomPoint, leftCtrl1),
        ...delta(bottomPoint, leftCtrl2),
        ...delta(bottomPoint, dip),
      ] as [number, number, number, number, number, number],
      [
        ...delta(dip, rightCtrl1),
        ...delta(dip, rightCtrl2),
        ...delta(dip, bottomPoint),
      ] as [number, number, number, number, number, number],
    ],
    bottomPoint[0],
    bottomPoint[1],
    [1, 1],
    "FD",
    true,
  );
}

/**
 * The point to center a swatch's code label on. For most shapes this is
 * just their (cx, cy); a heart's visual mass sits below its bounding box's
 * center (the top lobes are wide, the bottom tapers to a point), so its
 * label anchor is nudged down to sit in the lobes rather than the dip.
 */
function swatchLabelAnchor(shape: SwatchShape, cx: number, cy: number, size: number): [number, number] {
  if (shape === "heart") return [cx, cy + size * 0.08];
  return [cx, cy];
}

/**
 * Fills+strokes one swatch of the given shape, centered at (cx, cy), sized
 * to fit within a `size` x `size` box (matching a square's footprint so the
 * row layout stays uniform regardless of shape).
 */
function drawSwatchShape(doc: jsPDF, shape: SwatchShape, cx: number, cy: number, size: number): void {
  const half = size / 2;
  switch (shape) {
    case "square":
      doc.roundedRect(cx - half, cy - half, size, size, size * 0.18, size * 0.18, "FD");
      return;
    case "circle":
      doc.circle(cx, cy, half, "FD");
      return;
    case "hexagon":
      drawPolygon(doc, cx, cy, half, 6, -90);
      return;
    case "heart":
      drawHeart(doc, cx, cy, size);
      return;
  }
}

const PALETTE_MAX_PER_COLUMN = 10;

function paletteColumnCount(swatchCount: number): number {
  return Math.ceil(swatchCount / PALETTE_MAX_PER_COLUMN);
}

function paletteColumnHeight(swatchCount: number, swatchSize: number, rowGap: number): number {
  const rows = Math.min(swatchCount, PALETTE_MAX_PER_COLUMN);
  return rows * swatchSize + (rows - 1) * rowGap;
}

/**
 * Draws the palette as one or more columns, each running top to bottom and
 * capped at `PALETTE_MAX_PER_COLUMN` swatches — once a column fills up, the
 * next column starts to its left, so a long palette grows leftward across
 * the page rather than overflowing past the bottom margin. Each row pairs a
 * blank note box (for the reader to write a name/word onto, with a "...."
 * placeholder) with a real-color swatch to its right, sized/shaped per
 * `shape` with its code centered inside. `right`/`top` anchor the
 * rightmost column so callers can keep it inside the page's safe margin.
 */
function drawPaletteColumn(
  doc: jsPDF,
  swatches: PaletteSwatch[],
  shape: SwatchShape,
  right: number,
  top: number,
  swatchSize: number,
  rowGap: number,
  noteWidth: number,
  noteGap: number,
  columnGap: number,
  fontSize: number,
): void {
  const rowStride = swatchSize + rowGap;
  const cornerRadius = swatchSize * 0.18;
  const columnStride = noteWidth + noteGap + swatchSize + columnGap;

  for (const [i, swatch] of swatches.entries()) {
    const col = Math.floor(i / PALETTE_MAX_PER_COLUMN);
    const row = i % PALETTE_MAX_PER_COLUMN;
    const columnRight = right - col * columnStride;
    const cy = top + row * rowStride + swatchSize / 2;
    const cx = columnRight - swatchSize / 2;
    const noteLeft = cx - swatchSize / 2 - noteGap - noteWidth;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.15);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(noteLeft, cy - swatchSize / 2, noteWidth, swatchSize, cornerRadius, cornerRadius, "S");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(fontSize);
    doc.setTextColor(150, 150, 150);
    doc.text("......................", noteLeft + noteWidth / 2, cy + swatchSize * 0.15, {
      align: "center",
      baseline: "middle",
    });
    doc.setTextColor(0, 0, 0);

    doc.setFillColor(swatch.r, swatch.g, swatch.b);
    drawSwatchShape(doc, shape, cx, cy, swatchSize);

    const textColor = relativeLuminance(swatch.r, swatch.g, swatch.b) > 140 ? 0 : 255;
    doc.setTextColor(textColor, textColor, textColor);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(fontSize);
    const [labelX, labelY] = swatchLabelAnchor(shape, cx, cy, swatchSize);
    doc.text(swatch.code, labelX, labelY, { align: "center", baseline: "middle" });
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0, 0, 0);
  }
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
export async function generateBatchPdf(
  items: PdfExportItem[],
  onProgress?: (progress: PdfExportProgress) => void,
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

    if (index > 0) doc.addPage();

    const shape = SHAPE_CYCLE[index % SHAPE_CYCLE.length];
    // Shrink the note box width (columns scale with it) if the palette
    // needs more columns than fit across the page's safe content width —
    // keeps a long palette inside the margin instead of running past the
    // left edge.
    const columns = paletteColumnCount(swatches.length);
    const naturalColumnWidth = PALETTE_NOTE_WIDTH_MM + PALETTE_NOTE_GAP_MM + PALETTE_PAGE_SWATCH_MM;
    const naturalWidth = columns * naturalColumnWidth + (columns - 1) * PALETTE_COLUMN_GAP_MM;
    const shrink = Math.min(1, contentWidth / naturalWidth);
    const swatchSize = PALETTE_PAGE_SWATCH_MM * shrink;
    const rowGap = PALETTE_ROW_GAP_MM * shrink;
    const noteWidth = PALETTE_NOTE_WIDTH_MM * shrink;
    const noteGap = PALETTE_NOTE_GAP_MM * shrink;
    const columnGap = PALETTE_COLUMN_GAP_MM * shrink;
    const columnHeight = paletteColumnHeight(swatches.length, swatchSize, rowGap);
    const columnTop = MARGIN_MM + (contentHeight - columnHeight) / 2;
    const columnRight = PAGE_WIDTH_MM - MARGIN_MM - 0.3 * IN_TO_MM;
    drawPaletteColumn(
      doc,
      swatches,
      shape,
      columnRight,
      columnTop,
      swatchSize,
      rowGap,
      noteWidth,
      noteGap,
      columnGap,
      Math.max(4, 10 * shrink),
    );

    doc.addPage();
    drawCover(doc, outlineImg, outlineDataUrl, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);

    thumbnails.push({ dataUrl: coloredDataUrl, img: coloredImg });

    done += 1;
    onProgress?.({ done, total });
  }

  const cellWidth = (contentWidth - GAP_MM * (SUMMARY_COLUMNS - 1)) / SUMMARY_COLUMNS;
  const cellHeight = (contentHeight - GAP_MM * (SUMMARY_ROWS - 1)) / SUMMARY_ROWS;

  for (let i = 0; i < thumbnails.length; i += 1) {
    const posOnPage = i % SUMMARY_PER_PAGE;
    if (posOnPage === 0) doc.addPage();
    const col = posOnPage % SUMMARY_COLUMNS;
    const row = Math.floor(posOnPage / SUMMARY_COLUMNS);
    const x = MARGIN_MM + col * (cellWidth + GAP_MM);
    const y = MARGIN_MM + row * (cellHeight + GAP_MM);

    const { dataUrl, img } = thumbnails[i];
    drawContained(doc, img, dataUrl, x, y, cellWidth, cellHeight);
  }

  return doc.output("blob");
}
