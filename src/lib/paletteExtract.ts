import { fetchArtifactBlob } from "@/lib/api";

export interface PaletteSwatch {
  index: number;
  code: string;
  /** "#rrggbb" */
  hex: string;
  r: number;
  g: number;
  b: number;
}

const CHIP_RECT_RE = /<rect id="chip-(\d+)"[^>]*\bfill="(#[0-9a-fA-F]{6})"[^>]*\/>/g;
const CHIP_NUMBER_RE = /<text id="chip-number-(\d+)"[^>]*>([^<]+)<\/text>/g;

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const value = hex.replace("#", "");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

/** Parses the `<g id="legend">` chips out of a job's SVG artifact — the
 * only place palette code + color are exposed today (no JSON endpoint). */
export function parsePaletteFromSvg(svgText: string): PaletteSwatch[] {
  const colorsByIndex = new Map<number, string>();
  for (const match of svgText.matchAll(CHIP_RECT_RE)) {
    colorsByIndex.set(Number(match[1]), match[2]);
  }
  const codesByIndex = new Map<number, string>();
  for (const match of svgText.matchAll(CHIP_NUMBER_RE)) {
    codesByIndex.set(Number(match[1]), match[2].trim());
  }

  const swatches: PaletteSwatch[] = [];
  for (const [index, hex] of colorsByIndex) {
    const { r, g, b } = hexToRgb(hex);
    swatches.push({ index, code: codesByIndex.get(index) ?? String(index), hex, r, g, b });
  }
  return swatches.sort((a, b) => a.index - b.index);
}

export async function fetchPaletteSwatches(jobId: string): Promise<PaletteSwatch[]> {
  const blob = await fetchArtifactBlob(jobId, "svg");
  const svgText = await blob.text();
  return parsePaletteFromSvg(svgText);
}

/**
 * Estimates each palette color's area coverage (0..1) by decoding
 * `preview_colored` into a canvas and assigning every pixel to its nearest
 * palette color. Approximate, not exact: preview_colored anti-aliases fills
 * and overlays black outline/label ink, so edge and text pixels get pulled
 * toward whichever palette color they're nearest to rather than excluded —
 * fine for a rough "how much of the page is this color" indicator, not a
 * precise pixel accounting.
 */
export async function computeCoverage(
  coloredImage: HTMLImageElement,
  swatches: PaletteSwatch[],
): Promise<Map<number, number>> {
  const canvas = document.createElement("canvas");
  canvas.width = coloredImage.naturalWidth;
  canvas.height = coloredImage.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx || swatches.length === 0) return new Map();

  ctx.drawImage(coloredImage, 0, 0);
  const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);

  const counts = new Map<number, number>(swatches.map((s) => [s.index, 0]));
  let totalCounted = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3];
    if (alpha < 8) continue; // transparent background, not part of the artwork
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];

    let bestIndex = swatches[0].index;
    let bestDistSq = Infinity;
    for (const swatch of swatches) {
      const dr = r - swatch.r;
      const dg = g - swatch.g;
      const db = b - swatch.b;
      const distSq = dr * dr + dg * dg + db * db;
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        bestIndex = swatch.index;
      }
    }
    counts.set(bestIndex, (counts.get(bestIndex) ?? 0) + 1);
    totalCounted += 1;
  }

  const coverage = new Map<number, number>();
  for (const [index, count] of counts) {
    coverage.set(index, totalCounted > 0 ? count / totalCounted : 0);
  }
  return coverage;
}
