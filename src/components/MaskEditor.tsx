"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface MaskEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onMaskChange: (maskBase64: string | null) => void;
}

/** Max undo snapshots kept (each is a full-resolution ImageData of the mask
 * layer only, so the memory cost is width*height*4 bytes apiece). */
const MAX_HISTORY = 20;

/**
 * Canvas-based mask editor: the user paints to mark regions as "no color" (left
 * blank for the end user to color in).
 *
 * Two stacked canvases: the artwork is a plain <img> underneath, and only the
 * strokes live on the canvas. That separation matters -- the exported mask is
 * read from the stroke layer's *alpha*, so a bright pixel of the artwork can
 * never be mistaken for a painted pixel.
 */
export function MaskEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  onMaskChange,
}: Readonly<MaskEditorProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const [brushSize, setBrushSize] = useState(40);
  const [erasing, setErasing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);

  // Size the stroke layer to the artwork. Keyed on the dimensions only, NOT on
  // imageUrl: the backdrop is swapped from the raw upload to the rendered
  // colored preview mid-session, and that must not erase what's been painted.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    canvas.getContext("2d")?.clearRect(0, 0, imageWidth, imageHeight);
    historyRef.current = [];
    setHasStrokes(false);
  }, [imageWidth, imageHeight]);

  /** Export the stroke layer as a binary black/white PNG data URL:
   * white (255) = no_color, black (0) = keep colored. */
  const emitMask = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const strokes = ctx.getImageData(0, 0, imageWidth, imageHeight).data;

    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = imageWidth;
    maskCanvas.height = imageHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return;
    const out = maskCtx.createImageData(imageWidth, imageHeight);
    const data = out.data;

    let painted = 0;
    for (let i = 0; i < strokes.length; i += 4) {
      // Alpha is the only signal: anything the brush touched is opaque-ish.
      const on = strokes[i + 3] > 64;
      if (on) painted++;
      const v = on ? 255 : 0;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
    maskCtx.putImageData(out, 0, 0);

    setHasStrokes(painted > 0);
    onMaskChange(painted > 0 ? maskCanvas.toDataURL("image/png") : null);
  }, [imageWidth, imageHeight, onMaskChange]);

  const pushHistory = useCallback(() => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    historyRef.current.push(ctx.getImageData(0, 0, imageWidth, imageHeight));
    if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
  }, [imageWidth, imageHeight]);

  /** Pointer position in canvas pixels (the canvas is CSS-scaled to fit). */
  const toCanvasPoint = (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((clientX - rect.left) / rect.width) * canvas.width,
      y: ((clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const strokeTo = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;
      const point = toCanvasPoint(canvas, clientX, clientY);
      // Brush size is in displayed pixels; scale it to canvas pixels so the
      // cursor footprint matches what the user sees at any zoom.
      const rect = canvas.getBoundingClientRect();
      const radius = (brushSize / 2) * (canvas.width / rect.width);

      ctx.globalCompositeOperation = erasing ? "destination-out" : "source-over";
      ctx.strokeStyle = "rgba(255, 0, 0, 1)";
      ctx.fillStyle = "rgba(255, 0, 0, 1)";
      ctx.lineWidth = radius * 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const from = lastPointRef.current;
      if (from) {
        // Connect successive pointer samples so a fast drag stays a solid
        // stroke instead of a dotted trail.
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(point.x, point.y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalCompositeOperation = "source-over";
      lastPointRef.current = point;
    },
    [brushSize, erasing],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.pointerType === "mouse") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    pushHistory();
    drawingRef.current = true;
    lastPointRef.current = null;
    strokeTo(e.clientX, e.clientY);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    strokeTo(e.clientX, e.clientY);
  };

  const handlePointerUp = () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    lastPointRef.current = null;
    // Export once per stroke, not per pointer sample -- a full-resolution
    // toDataURL on every mousemove is what makes this feel sluggish.
    emitMask();
  };

  const handleUndo = () => {
    const ctx = canvasRef.current?.getContext("2d");
    const previous = historyRef.current.pop();
    if (!ctx || !previous) return;
    ctx.putImageData(previous, 0, 0);
    emitMask();
  };

  const handleClear = () => {
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx) return;
    pushHistory();
    ctx.clearRect(0, 0, imageWidth, imageHeight);
    emitMask();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-foreground/70">
        Paint over the areas that should stay white (uncolored) for the end user to fill in.
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="brushSize" className="text-sm whitespace-nowrap">
          Brush size:
        </label>
        <input
          id="brushSize"
          type="range"
          min={5}
          max={200}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-12 text-right text-xs">{brushSize}px</span>
      </div>

      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-pressed={!erasing}
          onClick={() => setErasing(false)}
          className={`rounded border px-3 py-1 text-sm ${
            erasing ? "border-border hover:bg-surface" : "border-accent bg-accent text-white"
          }`}
        >
          Paint
        </button>
        <button
          type="button"
          aria-pressed={erasing}
          onClick={() => setErasing(true)}
          className={`rounded border px-3 py-1 text-sm ${
            erasing ? "border-accent bg-accent text-white" : "border-border hover:bg-surface"
          }`}
        >
          Erase
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={handleUndo}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-40"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleClear}
          disabled={!hasStrokes}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-surface disabled:opacity-40"
        >
          Clear
        </button>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface">
        <div className="relative" style={{ aspectRatio: `${imageWidth} / ${imageHeight}` }}>
          {/* Artwork underlay -- never read back, so it cannot pollute the mask.
              next/image is not usable here: the source is a runtime data URL or
              an API artifact URL, and it must align pixel-for-pixel with the
              canvas above it (no optimizer resizing). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt=""
            draggable={false}
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
          />
          <canvas
            ref={canvasRef}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="absolute inset-0 h-full w-full cursor-crosshair touch-none opacity-50"
          />
        </div>
      </div>
    </div>
  );
}
