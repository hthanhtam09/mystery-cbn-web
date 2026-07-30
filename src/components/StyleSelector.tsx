"use client";

import type { ConvertStyle } from "@/hooks/useBatchConvert";

export interface StyleSelectorProps {
  style: ConvertStyle;
  onChange: (style: ConvertStyle) => void;
}

/**
 * Lets the user pick the conversion style before uploading: the full
 * "dense" mystery page, or "partial" — most of the subject pre-solved, and the
 * areas the user paints in the mask editor left as outline-only for the end
 * user to color in themselves (see the Disney "mystery coloring" reference).
 *
 * There is deliberately no "leave the largest N% blank" slider: the mask
 * editor is the only way to choose the blank areas, and a second, conflicting
 * control would just be ignored (a hand-drawn bitmap always wins over the
 * engine's area heuristic).
 */
export function StyleSelector({ style, onChange }: Readonly<StyleSelectorProps>) {
  const isPartial = style.preset === "partial";

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
          onClick={() => onChange({ preset: "partial" })}
          className={`rounded px-3 py-1 text-sm ${isPartial ? "bg-accent text-white" : "hover:bg-surface"}`}
        >
          Partially colored
        </button>
      </div>

      {isPartial && (
        <p className="text-xs text-foreground/60">
          After uploading, a preview opens where you paint the areas to leave blank for coloring.
        </p>
      )}
    </div>
  );
}
