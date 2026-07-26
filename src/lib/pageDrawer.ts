import type { jsPDF } from "jspdf";

/** "F" fill only, "S" stroke only, "FD" fill then stroke — mirrors jsPDF's style codes. */
export type DrawStyle = "F" | "S" | "FD";

export interface TextOptions {
  align: "left" | "center" | "right";
  baseline: "top" | "middle" | "bottom";
  color: [number, number, number];
  bold?: boolean;
  fontSizePt: number;
}

/**
 * A page surface abstracted over mm coordinates (same coordinate space
 * jsPDF uses natively), so the same palette-page layout logic can render
 * either into a print PDF (JsPdfDrawer) or into a standalone raster PNG
 * (CanvasDrawer) for the zip-export "palette" folder — both must draw
 * pixel-for-pixel-equivalent output since the zip is meant to reproduce
 * exactly what the PDF export would have contained.
 */
export interface PageDrawer {
  setFillColor(r: number, g: number, b: number): void;
  setDrawColor(r: number, g: number, b: number): void;
  setLineWidth(mm: number): void;
  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: DrawStyle): void;
  circle(cx: number, cy: number, r: number, style: DrawStyle): void;
  /** Closed straight-line polygon through absolute (mm) points. */
  polygon(points: [number, number][], style: DrawStyle): void;
  /**
   * Closed path of two cubic bezier segments through absolute (mm) control
   * points — the only shape (heart) that needs curves.
   */
  heartPath(
    bottomPoint: [number, number],
    leftCtrl1: [number, number],
    leftCtrl2: [number, number],
    dip: [number, number],
    rightCtrl1: [number, number],
    rightCtrl2: [number, number],
    style: DrawStyle,
  ): void;
  text(str: string, x: number, y: number, opts: TextOptions): void;
}

export class JsPdfDrawer implements PageDrawer {
  constructor(private readonly doc: jsPDF) {}

  setFillColor(r: number, g: number, b: number): void {
    this.doc.setFillColor(r, g, b);
  }

  setDrawColor(r: number, g: number, b: number): void {
    this.doc.setDrawColor(r, g, b);
  }

  setLineWidth(mm: number): void {
    this.doc.setLineWidth(mm);
  }

  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: DrawStyle): void {
    this.doc.roundedRect(x, y, w, h, rx, ry, style);
  }

  circle(cx: number, cy: number, r: number, style: DrawStyle): void {
    this.doc.circle(cx, cy, r, style);
  }

  polygon(points: [number, number][], style: DrawStyle): void {
    const deltas: [number, number][] = points.slice(1).map((p, i) => [p[0] - points[i][0], p[1] - points[i][1]]);
    const last = points.at(-1) ?? points[0];
    deltas.push([points[0][0] - last[0], points[0][1] - last[1]]);
    this.doc.lines(deltas, points[0][0], points[0][1], [1, 1], style, true);
  }

  heartPath(
    bottomPoint: [number, number],
    leftCtrl1: [number, number],
    leftCtrl2: [number, number],
    dip: [number, number],
    rightCtrl1: [number, number],
    rightCtrl2: [number, number],
    style: DrawStyle,
  ): void {
    const delta = (from: [number, number], to: [number, number]): [number, number] => [
      to[0] - from[0],
      to[1] - from[1],
    ];
    this.doc.lines(
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
      style,
      true,
    );
  }

  text(str: string, x: number, y: number, opts: TextOptions): void {
    this.doc.setFont("helvetica", opts.bold ? "bold" : "normal");
    this.doc.setFontSize(opts.fontSizePt);
    this.doc.setTextColor(opts.color[0], opts.color[1], opts.color[2]);
    this.doc.text(str, x, y, { align: opts.align, baseline: opts.baseline });
  }
}

/** Renders into a raster PNG canvas sized `pageWidthMm` x `pageHeightMm` at `dpi`. */
export class CanvasDrawer implements PageDrawer {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly scale: number;

  constructor(pageWidthMm: number, pageHeightMm: number, dpi = 300) {
    this.scale = dpi / 25.4;
    this.canvas = document.createElement("canvas");
    this.canvas.width = Math.round(pageWidthMm * this.scale);
    this.canvas.height = Math.round(pageHeightMm * this.scale);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("failed to create 2d canvas context");
    this.ctx = ctx;
    this.ctx.fillStyle = "#ffffff";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private px(mm: number): number {
    return mm * this.scale;
  }

  setFillColor(r: number, g: number, b: number): void {
    this.ctx.fillStyle = `rgb(${r},${g},${b})`;
  }

  setDrawColor(r: number, g: number, b: number): void {
    this.ctx.strokeStyle = `rgb(${r},${g},${b})`;
  }

  setLineWidth(mm: number): void {
    this.ctx.lineWidth = this.px(mm);
  }

  private applyStyle(style: DrawStyle): void {
    if (style === "F" || style === "FD") this.ctx.fill();
    if (style === "S" || style === "FD") this.ctx.stroke();
  }

  roundedRect(x: number, y: number, w: number, h: number, rx: number, ry: number, style: DrawStyle): void {
    const px = this.px(x);
    const py = this.px(y);
    const pw = this.px(w);
    const ph = this.px(h);
    const prx = this.px(rx);
    const pry = this.px(ry);
    this.ctx.beginPath();
    this.ctx.moveTo(px + prx, py);
    this.ctx.lineTo(px + pw - prx, py);
    this.ctx.quadraticCurveTo(px + pw, py, px + pw, py + pry);
    this.ctx.lineTo(px + pw, py + ph - pry);
    this.ctx.quadraticCurveTo(px + pw, py + ph, px + pw - prx, py + ph);
    this.ctx.lineTo(px + prx, py + ph);
    this.ctx.quadraticCurveTo(px, py + ph, px, py + ph - pry);
    this.ctx.lineTo(px, py + pry);
    this.ctx.quadraticCurveTo(px, py, px + prx, py);
    this.ctx.closePath();
    this.applyStyle(style);
  }

  circle(cx: number, cy: number, r: number, style: DrawStyle): void {
    this.ctx.beginPath();
    this.ctx.arc(this.px(cx), this.px(cy), this.px(r), 0, Math.PI * 2);
    this.ctx.closePath();
    this.applyStyle(style);
  }

  polygon(points: [number, number][], style: DrawStyle): void {
    this.ctx.beginPath();
    points.forEach(([x, y], i) => {
      const px = this.px(x);
      const py = this.px(y);
      if (i === 0) this.ctx.moveTo(px, py);
      else this.ctx.lineTo(px, py);
    });
    this.ctx.closePath();
    this.applyStyle(style);
  }

  heartPath(
    bottomPoint: [number, number],
    leftCtrl1: [number, number],
    leftCtrl2: [number, number],
    dip: [number, number],
    rightCtrl1: [number, number],
    rightCtrl2: [number, number],
    style: DrawStyle,
  ): void {
    const p = (pt: [number, number]): [number, number] => [this.px(pt[0]), this.px(pt[1])];
    const [bx, by] = p(bottomPoint);
    const [lc1x, lc1y] = p(leftCtrl1);
    const [lc2x, lc2y] = p(leftCtrl2);
    const [dx, dy] = p(dip);
    const [rc1x, rc1y] = p(rightCtrl1);
    const [rc2x, rc2y] = p(rightCtrl2);
    this.ctx.beginPath();
    this.ctx.moveTo(bx, by);
    this.ctx.bezierCurveTo(lc1x, lc1y, lc2x, lc2y, dx, dy);
    this.ctx.bezierCurveTo(rc1x, rc1y, rc2x, rc2y, bx, by);
    this.ctx.closePath();
    this.applyStyle(style);
  }

  text(str: string, x: number, y: number, opts: TextOptions): void {
    this.ctx.fillStyle = `rgb(${opts.color[0]},${opts.color[1]},${opts.color[2]})`;
    this.ctx.font = `${opts.bold ? "bold " : ""}${this.px(opts.fontSizePt / 2.834646)}px helvetica`;
    this.ctx.textAlign = opts.align;
    this.ctx.textBaseline = opts.baseline === "middle" ? "middle" : opts.baseline;
    this.ctx.fillText(str, this.px(x), this.px(y));
  }

  toBlob(): Promise<Blob> {
    return new Promise((resolve, reject) => {
      this.canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("failed to encode canvas to PNG"));
      }, "image/png");
    });
  }
}
