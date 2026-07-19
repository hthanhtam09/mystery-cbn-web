"use client";

import { useCallback, useId, useRef, useState } from "react";

const ACCEPTED_TYPES = ["image/png", "image/jpeg", "image/webp"];

export interface UploaderProps {
  disabled?: boolean;
  onSubmit: (file: File) => void;
}

export function Uploader({ disabled = false, onSubmit }: UploaderProps) {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const inputId = useId();

  const acceptFile = useCallback((candidate: File | undefined) => {
    if (!candidate) return;
    if (!ACCEPTED_TYPES.includes(candidate.type)) {
      setValidationError("Please choose a PNG, JPEG, or WebP image.");
      setFile(null);
      return;
    }
    setValidationError(null);
    setFile(candidate);
  }, []);

  const handleDrop = useCallback(
    (event: React.DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      if (disabled) return;
      acceptFile(event.dataTransfer.files[0]);
    },
    [acceptFile, disabled],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent) => {
      event.preventDefault();
      if (!file) {
        setValidationError("Choose an image first.");
        return;
      }
      onSubmit(file);
    },
    [file, onSubmit],
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
          accept={ACCEPTED_TYPES.join(",")}
          disabled={disabled}
          onChange={(e) => acceptFile(e.target.files?.[0])}
          className="sr-only"
        />
        <p className="text-sm font-medium">
          {file ? file.name : "Drag & drop a photo, or click to choose one"}
        </p>
        <p className="text-xs text-foreground/60">PNG, JPEG, or WebP</p>
      </div>

      {validationError && (
        <p id={`${inputId}-error`} role="alert" className="text-sm text-red-600 dark:text-red-400">
          {validationError}
        </p>
      )}

      <button
        type="submit"
        disabled={disabled || !file}
        className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {disabled ? "Converting…" : "Convert"}
      </button>
    </form>
  );
}
