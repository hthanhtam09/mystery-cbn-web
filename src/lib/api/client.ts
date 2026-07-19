import type {
  ConvertResponse,
  ErrorResponse,
  HealthResponse,
  JobStatusResponse,
  SubmitConvertOptions,
} from "./types";

/** Thrown for any non-2xx response; carries the parsed API error when available. */
export class ApiError extends Error {
  readonly status: number;
  readonly errorType: string | null;

  constructor(status: number, message: string, errorType: string | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.errorType = errorType;
  }
}

function apiBaseUrl(): string {
  const url = process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_API_BASE_URL is not set — copy .env.local.example to .env.local",
    );
  }
  return url.replace(/\/+$/, "");
}

async function parseErrorBody(response: Response): Promise<ErrorResponse | null> {
  try {
    const body = (await response.json()) as unknown;
    if (
      body &&
      typeof body === "object" &&
      "message" in body &&
      typeof (body as ErrorResponse).message === "string"
    ) {
      return body as ErrorResponse;
    }
    // FastAPI's default HTTPException shape: {"detail": "..."}
    if (body && typeof body === "object" && "detail" in body) {
      const detail = (body as { detail: unknown }).detail;
      return { error_type: "HTTPError", message: String(detail) };
    }
  } catch {
    // response wasn't JSON; fall through
  }
  return null;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBaseUrl()}${path}`, init);
  if (!response.ok) {
    const parsed = await parseErrorBody(response);
    throw new ApiError(
      response.status,
      parsed?.message ?? `request to ${path} failed with status ${response.status}`,
      parsed?.error_type ?? null,
    );
  }
  return (await response.json()) as T;
}

export async function getHealth(): Promise<HealthResponse> {
  return requestJson<HealthResponse>("/v1/health");
}

export async function submitConvert(options: SubmitConvertOptions): Promise<ConvertResponse> {
  const form = new FormData();
  form.set("file", options.file);
  form.set("preset", options.preset ?? "medium");
  form.set("seed", String(options.seed ?? 0));
  if (options.overrides && Object.keys(options.overrides).length > 0) {
    form.set("overrides", JSON.stringify(options.overrides));
  }
  return requestJson<ConvertResponse>("/v1/convert", { method: "POST", body: form });
}

export async function getJobStatus(jobId: string): Promise<JobStatusResponse> {
  return requestJson<JobStatusResponse>(`/v1/jobs/${encodeURIComponent(jobId)}`);
}

export async function cancelJob(jobId: string): Promise<{ cancellation_requested: boolean }> {
  return requestJson<{ cancellation_requested: boolean }>(
    `/v1/jobs/${encodeURIComponent(jobId)}`,
    { method: "DELETE" },
  );
}

/** Absolute URL for a job artifact — safe to use directly as an <img src>.
 * For a user-facing download, use `fetchArtifactBlob` + an object URL instead:
 * a plain cross-origin `<a download>` ignores the attribute per spec unless
 * the response sends `Content-Disposition: attachment` (asAttachment=true
 * asks the API to do that), and even then some browsers still just navigate. */
export function downloadUrl(jobId: string, artifact: string, asAttachment = false): string {
  const base = `${apiBaseUrl()}/v1/download/${encodeURIComponent(jobId)}?artifact=${encodeURIComponent(artifact)}`;
  return asAttachment ? `${base}&as_attachment=true` : base;
}

export async function fetchArtifactBlob(jobId: string, artifact: string): Promise<Blob> {
  const response = await fetch(downloadUrl(jobId, artifact));
  if (!response.ok) {
    const parsed = await parseErrorBody(response);
    throw new ApiError(
      response.status,
      parsed?.message ?? `failed to fetch artifact ${artifact}`,
      parsed?.error_type ?? null,
    );
  }
  return await response.blob();
}
