/**
 * Types mirroring mystery-cbn's /v1 REST contract (adapters/api/schemas.py).
 * This is the ONLY place the frontend encodes knowledge of the API shape.
 */

export type JobState = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export type ArtifactKey =
  | "svg"
  | "pdf"
  | "preview_lineart"
  | "preview_solved"
  | "preview_colored"
  | "preview_palette";

export interface ConvertResponse {
  job_id: string;
}

export interface JobStatusResponse {
  job_id: string;
  state: JobState;
  fraction_complete: number;
  current_stage: string | null;
  error: string | null;
  error_type: string | null;
  downloads: Partial<Record<ArtifactKey, string>> | null;
}

export interface HealthResponse {
  status: "ok";
  engine_version: string;
}

export interface ErrorResponse {
  error_type: string;
  message: string;
}

export type Preset = "easy" | "medium" | "hard" | "dense";

export interface SubmitConvertOptions {
  file: File;
  preset?: Preset;
  seed?: number;
  overrides?: Record<string, unknown>;
}
