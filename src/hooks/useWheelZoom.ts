"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const DEFAULT_MIN_ZOOM = 0.25;
const DEFAULT_MAX_ZOOM = 4;
const DEFAULT_ZOOM = 1;
// Per-wheel-tick sensitivity: a standard 100-unit notch scales by ~e^0.12 ≈ 1.13.
const WHEEL_SENSITIVITY = 0.0012;
// Multiplier applied by the +/− buttons.
const BUTTON_STEP = 1.25;

export interface UseWheelZoomOptions {
  minZoom?: number;
  maxZoom?: number;
  /** Zoom factor used initially and on reset. */
  defaultZoom?: number;
}

export interface UseWheelZoomResult<T extends HTMLElement> {
  /** Attach to the scrollable element that should zoom on wheel and pan on drag. */
  targetRef: React.RefObject<T | null>;
  /** Current zoom factor. */
  zoom: number;
  canZoomIn: boolean;
  canZoomOut: boolean;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
}

interface Anchor {
  /** Anchor point in the target's client coordinates (kept fixed while zooming). */
  x: number;
  y: number;
  prevZoom: number;
  scrollLeft: number;
  scrollTop: number;
}

/**
 * Figma-style pan/zoom for a scrollable container whose content scales with
 * the returned `zoom` factor:
 *
 * - mouse wheel zooms smoothly (moderate speed), anchored at the cursor so
 *   the point under the pointer stays put;
 * - click-dragging pans the content (grab/grabbing cursor);
 * - +/− buttons zoom in discrete steps, anchored at the viewport center.
 *
 * The wheel listener is attached manually (not via onWheel) because React's
 * wheel events are passive by default, and zooming must preventDefault to
 * stop the container/page from scrolling instead.
 */
export function useWheelZoom<T extends HTMLElement>(
  options: UseWheelZoomOptions = {},
): UseWheelZoomResult<T> {
  const {
    minZoom = DEFAULT_MIN_ZOOM,
    maxZoom = DEFAULT_MAX_ZOOM,
    defaultZoom = DEFAULT_ZOOM,
  } = options;
  const [zoom, setZoom] = useState(defaultZoom);
  const targetRef = useRef<T | null>(null);
  const zoomRef = useRef(zoom);
  const anchorRef = useRef<Anchor | null>(null);

  useLayoutEffect(() => {
    zoomRef.current = zoom;
  }, [zoom]);

  const clamp = useCallback(
    (value: number) => Math.min(maxZoom, Math.max(minZoom, value)),
    [minZoom, maxZoom],
  );

  /** Zooms by `factor`, keeping the given client-space point visually fixed. */
  const zoomBy = useCallback(
    (factor: number, point?: { x: number; y: number }) => {
      const target = targetRef.current;
      const prevZoom = zoomRef.current;
      const nextZoom = clamp(prevZoom * factor);
      if (nextZoom === prevZoom) return;
      if (target) {
        const rect = target.getBoundingClientRect();
        anchorRef.current = {
          x: point ? point.x - rect.left : rect.width / 2,
          y: point ? point.y - rect.top : rect.height / 2,
          prevZoom,
          scrollLeft: target.scrollLeft,
          scrollTop: target.scrollTop,
        };
      }
      setZoom(nextZoom);
    },
    [clamp],
  );

  // After the zoomed content has re-rendered at its new size, shift the
  // scroll position so the anchor point stays under the cursor.
  useLayoutEffect(() => {
    const target = targetRef.current;
    const anchor = anchorRef.current;
    if (!target || !anchor) return;
    anchorRef.current = null;
    const ratio = zoom / anchor.prevZoom;
    target.scrollLeft = (anchor.scrollLeft + anchor.x) * ratio - anchor.x;
    target.scrollTop = (anchor.scrollTop + anchor.y) * ratio - anchor.y;
  }, [zoom]);

  const zoomIn = useCallback(() => zoomBy(BUTTON_STEP), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(1 / BUTTON_STEP), [zoomBy]);
  const resetZoom = useCallback(() => setZoom(defaultZoom), [defaultZoom]);

  useEffect(() => {
    const target = targetRef.current;
    if (!target) return;

    const onWheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      zoomBy(Math.exp(-event.deltaY * WHEEL_SENSITIVITY), {
        x: event.clientX,
        y: event.clientY,
      });
    };

    let panLast: { x: number; y: number } | null = null;

    const onMouseMove = (event: MouseEvent) => {
      if (!panLast) return;
      event.preventDefault();
      target.scrollLeft -= event.clientX - panLast.x;
      target.scrollTop -= event.clientY - panLast.y;
      panLast = { x: event.clientX, y: event.clientY };
    };

    const endPan = () => {
      if (!panLast) return;
      panLast = null;
      target.style.cursor = "grab";
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", endPan);
    };

    const onMouseDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault(); // stop text/image selection while dragging
      panLast = { x: event.clientX, y: event.clientY };
      target.style.cursor = "grabbing";
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", endPan);
    };

    target.style.cursor = "grab";
    target.addEventListener("wheel", onWheel, { passive: false });
    target.addEventListener("mousedown", onMouseDown);
    return () => {
      endPan();
      target.style.cursor = "";
      target.removeEventListener("wheel", onWheel);
      target.removeEventListener("mousedown", onMouseDown);
    };
  }, [zoomBy]);

  return {
    targetRef,
    zoom,
    canZoomIn: zoom < maxZoom,
    canZoomOut: zoom > minZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
