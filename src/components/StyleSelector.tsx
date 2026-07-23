"use client";

import { useId } from "react";
import type { ConvertStyle } from "@/hooks/useBatchConvert";

export interface StyleSelectorProps {
  style: ConvertStyle;
  onChange: (style: ConvertStyle) => void;
}

// "top_area_percentile" mirrors mystery-cbn's mask stage config (see
// config_defaults.py's "partial" preset overlay): the fraction of regions,
// largest-area first, left unnumbered and uncolored in the legend.
const DEFAULT_UNCOLORED_FRACTION = 0.5;

/**
 * Lets the user pick the conversion style before uploading: the full
 * "dense" mystery page, or "partial" — most of the subject pre-solved,
 * the largest remaining regions left as outline-only for the end user to
 * color in themselves (see the Disney "mystery coloring" reference).
 */
export function StyleSelector({ style, onChange }: Readonly<StyleSelectorProps>) {
  const sliderId = useId();
  const isPartial = style.preset === "partial";
  const uncoloredFraction =
    typeof style.overrides?.mask === "object" &&
    style.overrides.mask !== null &&
    "top_area_percentile" in style.overrides.mask
      ? Number((style.overrides.mask as { top_area_percentile: number }).top_area_percentile)
      : DEFAULT_UNCOLORED_FRACTION;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex gap-1 rounded-md border border-border p-1" role="tablist" aria-label="Coloring style">
        <button
          type="button"
          role="tab"
          aria-selected={!isPartial}
          onClick={() => onChange({ preset: "dense" })}
          className={`rounded px-3 py-1 text-sm ${!isPartial ? "bg-accent text-white" : "hover:bg-surface"}`}
        >
          Fully colored
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={isPartial}
          onClick={() =>
            onChange({
              preset: "partial",
              overrides: { mask: { top_area_percentile: uncoloredFraction } },
            })
          }
          className={`rounded px-3 py-1 text-sm ${isPartial ? "bg-accent text-white" : "hover:bg-surface"}`}
        >
          Partially colored
        </button>
      </div>

      {isPartial && (
        <label htmlFor={sliderId} className="flex flex-col gap-1 text-sm">
          <span className="text-foreground/70">
            Leave {Math.round(uncoloredFraction * 100)}% of the picture (largest areas) blank for
            coloring
          </span>
          <input
            id={sliderId}
            type="range"
            min={0.1}
            max={0.9}
            step={0.05}
            value={uncoloredFraction}
            onChange={(e) =>
              onChange({
                preset: "partial",
                overrides: { mask: { top_area_percentile: Number(e.target.value) } },
              })
            }
          />
        </label>
      )}
    </div>
  );
}
