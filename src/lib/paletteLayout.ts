import type { PaletteSwatch } from "@/lib/paletteExtract";
import type { DrawStyle, PageDrawer } from "@/lib/pageDrawer";

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
// Empty outline shape (same shape/size as the swatch, no fill) to its right,
// for the reader to tick off once that color is painted.
export const PALETTE_CHECK_GAP_MM = 4;
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
  style: DrawStyle,
): void {
  const points: [number, number][] = [];
  for (let i = 0; i < sides; i += 1) {
    const angle = ((rotationDeg + (360 / sides) * i) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  drawer.polygon(points, style);
}

/**
 * Draws an upright heart centered at (cx, cy), fit within a `size` x `size`
 * box: two round lobes at the top meeting at a center dip, tapering to one
 * point at the bottom.
 */
function drawHeart(drawer: PageDrawer, cx: number, cy: number, size: number, style: DrawStyle): void {
  const h = size / 2;
  const bottomPoint: [number, number] = [cx, cy + h * 1.05];
  const dip: [number, number] = [cx, cy - h * 0.4];
  const leftCtrl1: [number, number] = [cx - h * 1.05, cy + h * 0.25];
  const leftCtrl2: [number, number] = [cx - h * 1.15, cy - h * 0.7];
  const rightCtrl1: [number, number] = [cx + h * 1.15, cy - h * 0.7];
  const rightCtrl2: [number, number] = [cx + h * 1.05, cy + h * 0.25];
  drawer.heartPath(bottomPoint, leftCtrl1, leftCtrl2, dip, rightCtrl1, rightCtrl2, style);
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
 * Draws one shape of the given kind, centered at (cx, cy), sized to fit
 * within a `size` x `size` box (matching a square's footprint so the row
 * layout stays uniform regardless of shape). `style` controls fill vs.
 * stroke-only — swatches are filled with their color, while the item-number
 * badge reuses the same shape stroke-only so it visually matches the
 * palette's shape for that item.
 */
function drawSwatchShape(
  drawer: PageDrawer,
  shape: SwatchShape,
  cx: number,
  cy: number,
  size: number,
  style: DrawStyle = "FD",
): void {
  const half = size / 2;
  switch (shape) {
    case "square":
      drawer.roundedRect(cx - half, cy - half, size, size, size * 0.18, size * 0.18, style);
      return;
    case "circle":
      drawer.circle(cx, cy, half, style);
      return;
    case "hexagon":
      drawPolygon(drawer, cx, cy, half, 6, -90, style);
      return;
    case "heart":
      drawHeart(drawer, cx, cy, size, style);
      return;
  }
}

export function paletteColumnCount(swatchCount: number): number {
  return Math.ceil(swatchCount / PALETTE_MAX_PER_COLUMN);
}

/**
 * Splits `swatchCount` items across `columns` as evenly as possible (e.g. 16
 * across 2 columns -> [8, 8], not [10, 6]), with any remainder going to the
 * earliest columns — so the first column is never shorter than a later one.
 */
export function paletteColumnSizes(swatchCount: number, columns: number): number[] {
  const base = Math.floor(swatchCount / columns);
  const remainder = swatchCount % columns;
  return Array.from({ length: columns }, (_, c) => base + (c < remainder ? 1 : 0));
}

export function paletteColumnHeight(rowsInColumn: number, swatchSize: number, rowGap: number): number {
  return rowsInColumn * swatchSize + (rowsInColumn - 1) * rowGap;
}

/**
 * Draws the palette as one or more columns, each running top to bottom and
 * capped at `PALETTE_MAX_PER_COLUMN` swatches — once a column fills up, the
 * next column starts to its right, so the first swatches (lowest codes) sit
 * leftmost, closest to the page's left margin, and later columns march
 * rightward. Each row is, left to right: the real-color reference swatch
 * with its code centered inside, an empty outline for the reader to tick
 * off once that color is painted, then a blank note box (for the reader to
 * write a name/word onto, with a "...." placeholder). `left`/`top` anchor
 * the leftmost column so callers can keep it inside the page's safe margin.
 */
export interface PaletteColumnStyle {
  left: number;
  top: number;
  swatchSize: number;
  rowGap: number;
  noteWidth: number;
  noteGap: number;
  checkGap: number;
  columnGap: number;
  fontSize: number;
}

export function drawPaletteColumn(
  drawer: PageDrawer,
  swatches: PaletteSwatch[],
  shape: SwatchShape,
  style: PaletteColumnStyle,
): void {
  const { left, top, swatchSize, rowGap, noteWidth, noteGap, checkGap, columnGap, fontSize } = style;
  const rowStride = swatchSize + rowGap;
  const cornerRadius = swatchSize * 0.18;
  const columnStride = swatchSize + checkGap + swatchSize + noteGap + noteWidth + columnGap;
  const columns = paletteColumnCount(swatches.length);
  const columnSizes = paletteColumnSizes(swatches.length, columns);

  let col = 0;
  let row = 0;
  for (const swatch of swatches) {
    if (row >= columnSizes[col]) {
      col += 1;
      row = 0;
    }
    const columnLeft = left + col * columnStride;
    const cy = top + row * rowStride + swatchSize / 2;
    // Leftmost element in the row is the filled reference swatch, with the
    // empty tick-off outline to its right, and the note box to that's right.
    const cx = columnLeft + swatchSize / 2;
    const checkCx = cx + swatchSize / 2 + checkGap + swatchSize / 2;
    const noteLeft = checkCx + swatchSize / 2 + noteGap;

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

    drawer.setDrawColor(0, 0, 0);
    drawer.setLineWidth(0.15);
    drawSwatchShape(drawer, shape, checkCx, cy, swatchSize, "S");

    drawer.setFillColor(255, 255, 255);
    drawer.roundedRect(noteLeft, cy - swatchSize / 2, noteWidth, swatchSize, cornerRadius, cornerRadius, "S");
    drawer.text("......................", noteLeft + noteWidth / 2, cy + swatchSize * 0.15, {
      align: "center",
      baseline: "middle",
      color: [150, 150, 150],
      fontSizePt: fontSize,
    });

    row += 1;
  }
}

/** Computed sizing for a palette page's column layout, shrunk to fit `contentWidthMm`. */
export interface PaletteColumnLayout {
  swatchSize: number;
  rowGap: number;
  noteWidth: number;
  noteGap: number;
  checkGap: number;
  columnGap: number;
  columnHeight: number;
  columnLeft: number;
  fontSize: number;
}

export function computePaletteColumnLayout(
  swatches: PaletteSwatch[],
  pageWidthMm: number,
  marginMm: number,
  contentWidthMm: number,
): PaletteColumnLayout {
  const columns = paletteColumnCount(swatches.length);
  const columnSizes = paletteColumnSizes(swatches.length, columns);
  // Columns are sized across the *full* content width -- there is no
  // dedicated left-hand zone anymore (the old big number badge that
  // reserved one is gone; the title is now a single line of small text in
  // the top margin, which needs no horizontal room of its own).
  const naturalColumnWidth =
    PALETTE_NOTE_WIDTH_MM + PALETTE_NOTE_GAP_MM + PALETTE_PAGE_SWATCH_MM + PALETTE_CHECK_GAP_MM + PALETTE_PAGE_SWATCH_MM;
  const naturalWidth = columns * naturalColumnWidth + (columns - 1) * PALETTE_COLUMN_GAP_MM;
  const shrink = Math.min(1, contentWidthMm / naturalWidth);
  const swatchSize = PALETTE_PAGE_SWATCH_MM * shrink;
  const rowGap = PALETTE_ROW_GAP_MM * shrink;
  const noteWidth = PALETTE_NOTE_WIDTH_MM * shrink;
  const noteGap = PALETTE_NOTE_GAP_MM * shrink;
  const checkGap = PALETTE_CHECK_GAP_MM * shrink;
  const columnGap = PALETTE_COLUMN_GAP_MM * shrink;
  const columnHeight = paletteColumnHeight(Math.max(...columnSizes), swatchSize, rowGap);
  return {
    swatchSize,
    rowGap,
    noteWidth,
    noteGap,
    checkGap,
    columnGap,
    columnHeight,
    // Flush against the content box's left edge (i.e. `marginMm` -- already
    // the page's safe margin outside the KDP bleed/trim, per PAGE_WIDTH_MM /
    // MARGIN_MM in pdfExport.ts) rather than centered, so the columns sit as
    // far left as the safe area allows instead of floating mid-page.
    columnLeft: marginMm,
    fontSize: Math.max(4, 10 * shrink),
  };
}

// Plain small title text, top-left of the page -- no box, no shape, no big
// digits. Replaces the old stroke-only shape badge with big centered digits:
// that badge was the same size/shape as the item's own swatches, which read
// as "yet another swatch" rather than a page header, and gave no way to
// print the artwork's name (only its raw number). "{Name} #{number}" is
// plain, single-line text -- the name in black, "#{number}" in gray so the
// two read as distinct fields on the line; falls back to "#{number}" alone
// (still gray) when no name was imported for this item.
const PALETTE_TITLE_FONT_PT = 18;
const PALETTE_TITLE_NUMBER_GRAY: [number, number, number] = [130, 130, 130];
// Rule separating the title from the color table below it, and the table's
// own vertical anchor -- close under the title/rule rather than centered
// in the remaining page height, so the table reads as "part of the header
// block" instead of floating in the middle of the page.
const PALETTE_TITLE_LINE_HEIGHT_MM = PALETTE_TITLE_FONT_PT * 0.3528 * 1.3;
const PALETTE_RULE_GAP_ABOVE_MM = 3;
const PALETTE_RULE_THICKNESS_MM = 0.5;
const PALETTE_RULE_GAP_BELOW_MM = 7;
const PALETTE_RULE_COLOR: [number, number, number] = [0, 0, 0];

/**
 * Draws one item's full palette page (background handled by caller) onto
 * `drawer`. `itemNumber` is the source image's own 1-based number (see
 * `parseItemNumber` in pdfExport.ts) — it drives the shape cycled through
 * `SHAPE_CYCLE`, so the same source image always gets the same shape
 * regardless of which batch it's exported in, and is also how `name` (this
 * item's row from the imported name CSV, already resolved by the caller --
 * see `parseArtworkNames` in captionsCsv.ts) is looked up: matched by the
 * artwork's own number, not by batch position, so a batch converted out of
 * order or covering only some of the CSV's rows still gets the right name.
 * Printed as small plain text "{Name} #{number}" in the page's top-left
 * margin — no box, no shape. Falls back to "#{number}" alone with no name.
 */
export interface PalettePageGeometry {
  pageWidthMm: number;
  marginMm: number;
  contentWidthMm: number;
  /** Unused by this function (the table anchors under the title/rule, not
   * centered in the content box) -- kept so callers don't need a special
   * case just to omit it. */
  contentHeightMm: number;
  /** This item's name from the imported name CSV, if any (see docstring above). */
  name?: string;
}

export function drawPalettePage(
  drawer: PageDrawer,
  swatches: PaletteSwatch[],
  itemNumber: number,
  geometry: PalettePageGeometry,
): void {
  const { pageWidthMm, marginMm, contentWidthMm, name } = geometry;
  const shape = SHAPE_CYCLE[(itemNumber - 1) % SHAPE_CYCLE.length];
  const layout = computePaletteColumnLayout(swatches, pageWidthMm, marginMm, contentWidthMm);

  const titleY = marginMm + PALETTE_TITLE_FONT_PT * 0.3528;
  const namePart = name ? `${name} ` : "";
  const numberPart = `#${itemNumber}`;
  const nameWidth = namePart
    ? drawer.measureTextWidth(namePart, PALETTE_TITLE_FONT_PT)
    : 0;
  if (namePart) {
    drawer.text(namePart, marginMm, titleY, {
      align: "left",
      baseline: "middle",
      color: [0, 0, 0],
      fontSizePt: PALETTE_TITLE_FONT_PT,
    });
  }
  drawer.text(numberPart, marginMm + nameWidth, titleY, {
    align: "left",
    baseline: "middle",
    color: PALETTE_TITLE_NUMBER_GRAY,
    fontSizePt: PALETTE_TITLE_FONT_PT,
  });

  const ruleY = marginMm + PALETTE_TITLE_LINE_HEIGHT_MM + PALETTE_RULE_GAP_ABOVE_MM;
  drawer.setFillColor(...PALETTE_RULE_COLOR);
  drawer.roundedRect(marginMm, ruleY, contentWidthMm, PALETTE_RULE_THICKNESS_MM, 0, 0, "F");
  const columnTop = ruleY + PALETTE_RULE_THICKNESS_MM + PALETTE_RULE_GAP_BELOW_MM;

  drawPaletteColumn(drawer, swatches, shape, {
    left: layout.columnLeft,
    top: columnTop,
    swatchSize: layout.swatchSize,
    rowGap: layout.rowGap,
    noteWidth: layout.noteWidth,
    noteGap: layout.noteGap,
    checkGap: layout.checkGap,
    columnGap: layout.columnGap,
    fontSize: layout.fontSize,
  });
}
