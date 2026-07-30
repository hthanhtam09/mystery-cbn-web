"use client";

import { useEffect, useRef } from "react";

export interface PreviewCanvasProps {
  coloredPreviewUrl: string;
  maskBase64: string | null;
  width: number;
  height: number;
}

/**
 * Shows the colored preview with the masked regions knocked out to white — an
 * approximation of the printed page: what stays colored is what the numbers
 * will cover, what turns white is what the end user fills in.
 *
 * Composited with `destination-out` against an alpha stencil built from the
 * mask, deliberately: reading the colored preview back with `getImageData`
 * would throw on a cross-origin API host (a tainted canvas), while the mask is
 * a same-origin data URL and is always safe to read.
 */
export function PreviewCanvas({
  coloredPreviewUrl,
  maskBase64,
  width,
  height,
}: Readonly<PreviewCanvasProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let cancelled = false;

    /** Turn the binary black/white mask into a stencil whose alpha is opaque
     * exactly where the user painted. */
    const buildStencil = async (): Promise<HTMLCanvasElement | null> => {
      if (!maskBase64) return null;
      const maskImg = await loadImage(maskBase64).catch(() => null);
      if (!maskImg) return null;

      const stencil = document.createElement("canvas");
      stencil.width = width;
      stencil.height = height;
      const stencilCtx = stencil.getContext("2d");
      if (!stencilCtx) return null;
      stencilCtx.drawImage(maskImg, 0, 0, width, height);
      const data = stencilCtx.getImageData(0, 0, width, height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        // White (>= 128) = masked. Encode it as alpha; color is irrelevant.
        px[i + 3] = px[i] >= 128 ? 255 : 0;
      }
      stencilCtx.putImageData(data, 0, 0);
      return stencil;
    };

    void (async () => {
      const [colored, stencil] = await Promise.all([
        loadImage(coloredPreviewUrl).catch(() => null),
        buildStencil(),
      ]);
      if (cancelled || !colored) return;

      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(colored, 0, 0, width, height);

      if (stencil) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(stencil, 0, 0);
      }

      // Paper under the knocked-out holes.
      ctx.globalCompositeOperation = "destination-over";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, width, height);
      ctx.globalCompositeOperation = "source-over";
    })();

    return () => {
      cancelled = true;
    };
  }, [coloredPreviewUrl, maskBase64, width, height]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-foreground/60">
        Preview: the white areas are what you painted — they get no number and no legend color.
      </div>
      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface">
        <canvas
          ref={canvasRef}
          style={{
            display: "block",
            width: "100%",
            height: "auto",
          }}
        />
      </div>
    </div>
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // Needed only for the cross-origin API host; harmless on a data URL.
    if (!src.startsWith("data:")) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src.slice(0, 64)}`));
    img.src = src;
  });
}
