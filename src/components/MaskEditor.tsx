"use client";

import { useEffect, useRef, useState } from "react";

export interface MaskEditorProps {
  imageUrl: string;
  imageWidth: number;
  imageHeight: number;
  onMaskChange: (maskBase64: string | null) => void;
}

/**
 * Canvas-based mask editor: user paints to mark regions as "no color" (to leave
 * blank for end-user to color). Red overlay = masked (no color), transparent = color.
 */
export function MaskEditor({
  imageUrl,
  imageWidth,
  imageHeight,
  onMaskChange,
}: Readonly<MaskEditorProps>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [brushSize, setBrushSize] = useState(20);
  const [imageData, setImageData] = useState<ImageData | null>(null);

  // Initialize canvas with the background image
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
      setImageData(ctx.getImageData(0, 0, imageWidth, imageHeight));
    };
    img.src = imageUrl;
  }, [imageUrl, imageWidth, imageHeight]);

  const getMaskFromCanvas = (): string | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    // Create a separate canvas for the mask (grayscale: 0 = color, 1 = no-color)
    const maskCanvas = document.createElement("canvas");
    maskCanvas.width = imageWidth;
    maskCanvas.height = imageHeight;
    const maskCtx = maskCanvas.getContext("2d");
    if (!maskCtx) return null;

    // Read current drawing state from the main canvas overlay
    const imageData = canvas.getContext("2d")?.getImageData(0, 0, imageWidth, imageHeight);
    if (!imageData) return null;

    const data = imageData.data;
    const maskImageData = maskCtx.createImageData(imageWidth, imageHeight);
    const maskData = maskImageData.data;

    // Convert RGBA overlay to grayscale mask: red channel > 128 = masked (1), else 0
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      maskData[i] = maskData[i + 1] = maskData[i + 2] = r > 128 ? 255 : 0;
      maskData[i + 3] = 255;
    }

    maskCtx.putImageData(maskImageData, 0, 0);
    return maskCanvas.toDataURL("image/png");
  };

  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    setIsDrawing(true);
    draw(e);
    updatePreview();
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;
    draw(e);
    updatePreview();
  };

  const handleMouseUp = () => {
    setIsDrawing(false);
    updatePreview();
  };

  const updatePreview = () => {
    const maskBase64 = getMaskFromCanvas();
    onMaskChange(maskBase64);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    // Map CSS coordinates to canvas coordinates (accounting for CSS scaling)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = (e.clientX - rect.left) * scaleX;
    const y = (e.clientY - rect.top) * scaleY;

    ctx.fillStyle = "rgba(255, 0, 0, 0.5)";
    ctx.beginPath();
    ctx.arc(x, y, (brushSize / 2) * scaleX, 0, Math.PI * 2);
    ctx.fill();
  };

  const handleClear = () => {
    const canvas = canvasRef.current;
    if (!canvas || !imageData) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);
    };
    img.src = imageUrl;

    onMaskChange(null);
  };

  const handleUndo = () => {
    // Simple undo: reload original image
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const img = new Image();
    img.onload = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const maskBase64 = getMaskFromCanvas();
      onMaskChange(maskBase64);
    };
    img.src = imageUrl;
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="text-sm text-foreground/70">
        Draw in red to mark areas that should stay white (uncolored) for the user to fill in
      </div>

      <div className="flex items-center gap-3">
        <label htmlFor="brushSize" className="text-sm">
          Brush size:
        </label>
        <input
          id="brushSize"
          type="range"
          min={5}
          max={100}
          value={brushSize}
          onChange={(e) => setBrushSize(Number(e.target.value))}
          className="flex-1"
        />
        <span className="w-12 text-right text-xs">{brushSize}px</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={handleUndo}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-surface"
        >
          Undo
        </button>
        <button
          type="button"
          onClick={handleClear}
          className="rounded border border-border px-3 py-1 text-sm hover:bg-surface"
        >
          Clear
        </button>
      </div>

      <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-surface">
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          className="cursor-crosshair"
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
