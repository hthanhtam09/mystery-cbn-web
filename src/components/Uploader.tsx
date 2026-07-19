"use client";

import { useCallback, useId, useRef, useState } from "react";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface UploaderProps {
  disabled?: boolean;
  onSubmit: (files: File[]) => void;
}

export function Uploader({ disabled = false, onSubmit }: UploaderProps) {
  const [files, setFiles] = useState<File[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const acceptFiles = useCallback((candidates: FileList | null | undefined) => {
    if (!candidates || candidates.length === 0) return;
    const accepted: File[] = [];
    const rejected: string[] = [];
    for (const candidate of Array.from(candidates)) {
      if (ACCEPTED_TYPES.includes(candidate.type)) {
        accepted.push(candidate);
      } else {
        rejected.push(candidate.name);
      }
    }
    setValidationError(
      rejected.length > 0
        ? `Skipped (not PNG, JPEG, or WebP): ${rejected.join(", ")}`
        : null,
    );
    if (accepted.length > 0) {
      // Appends to the current selection so users can pick files in several
      // rounds; duplicates by name+size are dropped.
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => `${f.name}:${f.size}`));
        return [...prev, ...accepted.filter((f) => !seen.has(`${f.name}:${f.size}`))];
      });
    }
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      acceptFiles(event.dataTransfer.files);
    },
    [acceptFiles, disabled],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (files.length === 0) {
        setValidationError("Choose at least one image first.");
        return;
      }
      onSubmit(files);
    },
    [files, onSubmit],
  );

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={disabled}
        aria-describedby={validationError ? `${inputId}-error` : undefined}
        onClick={() => !disabled && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (!disabled && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled) setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`flex min-h-40 cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
          isDragging ? "border-accent bg-accent/10" : "border-border"
        } ${disabled ? "cursor-not-allowed opacity-60" : "hover:border-accent"}`}
      >
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          multiple
          accept={ACCEPTED_TYPES.join(",")}
          disabled={disabled}
          onChange={(e) => {
            acceptFiles(e.target.files);
            // Allow re-selecting the same file(s) after removal.
            e.target.value = "";
          }}
          className="sr-only"
        />
        <p className="text-sm font-medium">
          {files.length > 0
            ? `${files.length} image${files.length > 1 ? "s" : ""} selected`
            : "Drag & drop photos, or click to choose"}
        </p>
        <p className="text-xs text-foreground/60">PNG, JPEG, or WebP — multiple files allowed</p>
      </div>

      {files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {files.map((file, index) => (
            <li
              key={`${file.name}:${file.size}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-1.5 text-sm"
            >
              <span className="truncate">{file.name}</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                aria-label={`Remove ${file.name}`}
                className="text-xs text-foreground/60 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {validationError && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {validationError}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled || files.length === 0}
        className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {disabled
          ? "Converting…"
          : files.length > 1
            ? `Convert ${files.length} images`
            : "Convert"}
      </button>
    </form>
  );
}
