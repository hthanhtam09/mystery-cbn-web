import type { PaletteSwatch } from "@/lib/paletteExtract";
import type { PageDrawer } from "@/lib/pageDrawer";

export type SwatchShape = "square" | "circle" | "hexagon" | "heart";
export const SHAPE_CYCLE: SwatchShape[] = ["square", "circle", "hexagon", "heart"];

export const PALETTE_SWATCH_MM = 6;
export const PALETTE_GAP_MM = 1;
// Larger swatch size for the palette's own dedicated page, where there's no
// outline artwork competing for space.
export const PALETTE_PAGE_SWATCH_MM = 14;
// Blank note box to the left of each swatch, for the reader to write in.
export const PALETTE_NOTE_WIDTH_MM = 40;
export const PALETTE_NOTE_GAP_MM = 4;
export const PALETTE_ROW_GAP_MM = 4;
// Horizontal gap between columns once a column fills past PALETTE_MAX_PER_COLUMN.
export const PALETTE_COLUMN_GAP_MM = 6;
export const PALETTE_MAX_PER_COLUMN = 10;

function relativeLuminance(r: number, g: number, b: number): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Draws a regular polygon (e.g. a hexagon) centered at (cx, cy). */
function drawPolygon(
  drawer: PageDrawer,
  cx: number,
  cy: number,
  radius: number,
  sides: number,
  rotationDeg: number,
): void {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  drawer.polygon(points, "FD");
}

/**
 * Draws an upright heart centered at (cx, cy), fit within a `size` x `size`
 * box: two round lobes at the top meeting at a center dip, tapering to one
 * point at the bottom.
 */
function drawHeart(drawer: PageDrawer, cx: number, cy: number, size: number): void {
  const h = size / 2;
  const bottomPoint: [number, number] = [cx, cy + h * 1.05];
  const dip: [number, number] = [cx, cy - h * 0.4];
  const leftCtrl1: [number, number] = [cx - h * 1.05, cy + h * 0.25];
  const leftCtrl2: [number, number] = [cx - h * 1.15, cy - h * 0.7];
  const rightCtrl1: [number, number] = [cx + h * 1.15, cy - h * 0.7];
  const rightCtrl2: [number, number] = [cx + h * 1.05, cy + h * 0.25];
  drawer.heartPath(bottomPoint, leftCtrl1, leftCtrl2, dip, rightCtrl1, rightCtrl2, "FD");
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
function drawSwatchShape(drawer: PageDrawer, shape: SwatchShape, cx: number, cy: number, size: number): void {
  const half = size / 2;
  switch (shape) {
    case "square":
      drawer.roundedRect(cx - half, cy - half, size, size, size * 0.18, size * 0.18, "FD");
      return;
    case "circle":
      drawer.circle(cx, cy, half, "FD");
      return;
    case "hexagon":
      drawPolygon(drawer, cx, cy, half, 6, -90);
      return;
    case "heart":
      drawHeart(drawer, cx, cy, size);
      return;
  }
}

export function paletteColumnCount(swatchCount: number): number {
  return Math.ceil(swatchCount / PALETTE_MAX_PER_COLUMN);
}

export function paletteColumnHeight(swatchCount: number, swatchSize: number, rowGap: number): number {
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
export function drawPaletteColumn(
  drawer: PageDrawer,
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

    drawer.setDrawColor(0, 0, 0);
    drawer.setLineWidth(0.15);
    drawer.setFillColor(255, 255, 255);
    drawer.roundedRect(noteLeft, cy - swatchSize / 2, noteWidth, swatchSize, cornerRadius, cornerRadius, "S");
    drawer.text("......................", noteLeft + noteWidth / 2, cy + swatchSize * 0.15, {
      align: "center",
      baseline: "middle",
      color: [150, 150, 150],
      fontSizePt: fontSize,
    });

    drawer.setFillColor(swatch.r, swatch.g, swatch.b);
    drawSwatchShape(drawer, shape, cx, cy, swatchSize);

    const textColor = relativeLuminance(swatch.r, swatch.g, swatch.b) > 140 ? 0 : 255;
    const [labelX, labelY] = swatchLabelAnchor(shape, cx, cy, swatchSize);
    drawer.text(swatch.code, labelX, labelY, {
      align: "center",
      baseline: "middle",
      color: [textColor, textColor, textColor],
      bold: true,
      fontSizePt: fontSize,
    });
  }
}

/** Computed sizing for a palette page's column layout, shrunk to fit `contentWidthMm`. */
export interface PaletteColumnLayout {
  swatchSize: number;
  rowGap: number;
  noteWidth: number;
  noteGap: number;
  columnGap: number;
  columnHeight: number;
  columnTop: number;
  columnRight: number;
  fontSize: number;
}

const IN_TO_MM = 25.4;

export function computePaletteColumnLayout(
  swatches: PaletteSwatch[],
  pageWidthMm: number,
  marginMm: number,
  contentWidthMm: number,
  contentHeightMm: number,
): PaletteColumnLayout {
  const columns = paletteColumnCount(swatches.length);
  const naturalColumnWidth = PALETTE_NOTE_WIDTH_MM + PALETTE_NOTE_GAP_MM + PALETTE_PAGE_SWATCH_MM;
  const naturalWidth = columns * naturalColumnWidth + (columns - 1) * PALETTE_COLUMN_GAP_MM;
  const shrink = Math.min(1, contentWidthMm / naturalWidth);
  const swatchSize = PALETTE_PAGE_SWATCH_MM * shrink;
  const rowGap = PALETTE_ROW_GAP_MM * shrink;
  const noteWidth = PALETTE_NOTE_WIDTH_MM * shrink;
  const noteGap = PALETTE_NOTE_GAP_MM * shrink;
  const columnGap = PALETTE_COLUMN_GAP_MM * shrink;
  const columnHeight = paletteColumnHeight(swatches.length, swatchSize, rowGap);
  const columnTop = marginMm + (contentHeightMm - columnHeight) / 2;
  const columnRight = pageWidthMm - marginMm - 0.3 * IN_TO_MM;
  return {
    swatchSize,
    rowGap,
    noteWidth,
    noteGap,
    columnGap,
    columnHeight,
    columnTop,
    columnRight,
    fontSize: Math.max(4, 10 * shrink),
  };
}

/** Draws one item's full palette page (background handled by caller) onto `drawer`. */
export function drawPalettePage(
  drawer: PageDrawer,
  swatches: PaletteSwatch[],
  shapeIndex: number,
  pageWidthMm: number,
  marginMm: number,
  contentWidthMm: number,
  contentHeightMm: number,
): void {
  const shape = SHAPE_CYCLE[shapeIndex % SHAPE_CYCLE.length];
  const layout = computePaletteColumnLayout(swatches, pageWidthMm, marginMm, contentWidthMm, contentHeightMm);
  drawPaletteColumn(
    drawer,
    swatches,
    shape,
    layout.columnRight,
    layout.columnTop,
    layout.swatchSize,
    layout.rowGap,
    layout.noteWidth,
    layout.noteGap,
    layout.columnGap,
    layout.fontSize,
  );
}
