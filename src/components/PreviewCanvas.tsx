"use client";

import { useEffect, useRef } from "react";

export interface PreviewCanvasProps {
  coloredPreviewUrl: string;
  maskBase64: string | null;
  width: number;
  height: number;
}

/**
 * Displays the colored preview with masked regions "erased" (transparent).
 * Composites: colored preview + apply alpha=0 to mask pixels.
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

    const coloredImg = new Image();
    coloredImg.onload = () => {
      ctx.drawImage(coloredImg, 0, 0);

      // If mask provided, erase masked regions
      if (maskBase64) {
        const maskImg = new Image();
        maskImg.onerror = () => console.error("Failed to load mask image");
        maskImg.onload = () => {
          try {
            // Draw mask to a temporary canvas at exact dimensions
            const tempCanvas = document.createElement("canvas");
            tempCanvas.width = width;
            tempCanvas.height = height;
            const tempCtx = tempCanvas.getContext("2d");
            if (!tempCtx) {
              console.error("Failed to get temp canvas context");
              return;
            }

            // Draw mask image and ensure it fills the canvas
            tempCtx.drawImage(maskImg, 0, 0, width, height);
            const maskImageData = tempCtx.getImageData(0, 0, width, height);
            const maskData = maskImageData.data;

            // Get current colored preview pixel data from main canvas
            const coloredImageData = ctx.getImageData(0, 0, width, height);
            const coloredData = coloredImageData.data;

            // Erase (set alpha=0) for masked pixels (red channel > 128 = masked)
            for (let i = 0; i < maskData.length; i += 4) {
              const r = maskData[i];
              // Mask semantics: red > 128 = masked region (don't color)
              if (r > 128) {
                coloredData[i + 3] = 0; // Set alpha to 0 (transparent)
              }
            }

            ctx.putImageData(coloredImageData, 0, 0);
          } catch (error) {
            console.error("Error applying mask:", error);
          }
        };
        maskImg.src = maskBase64;
      }
    };
    coloredImg.src = coloredPreviewUrl;
  }, [coloredPreviewUrl, maskBase64, width, height]);

  return (
    <div className="flex flex-col gap-2">
      <div className="text-xs text-foreground/60">
        Preview: masked areas (red) will be left white for coloring
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
