"use client";

import { useCallback, useEffect, useState } from "react";
import { DownloadButtons } from "@/components/DownloadButtons";
import { JobProgress } from "@/components/JobProgress";
import { MaskEditor } from "@/components/MaskEditor";
import { PreviewCanvas } from "@/components/PreviewCanvas";
import { PreviewViewer } from "@/components/PreviewViewer";
import { StyleSelector } from "@/components/StyleSelector";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Uploader } from "@/components/Uploader";
import { useBatchConvert } from "@/hooks/useBatchConvert";
import type { BatchItem, ConvertStyle } from "@/hooks/useBatchConvert";
import { downloadUrl, getJobStatus, submitConvert } from "@/lib/api";
import { useGeneratePdf } from "@/hooks/useGeneratePdf";
import { useGenerateZip } from "@/hooks/useGenerateZip";
import { useImportFolder } from "@/hooks/useImportFolder";
import { parseArtworkNames } from "@/lib/captionsCsv";
import type { ArtworkName } from "@/lib/captionsCsv";

const TERMINAL_STATES = new Set(["succeeded", "failed", "cancelled"]);

/** Backdrop preview poll budget: 1 s x 180 = 3 min, comfortably above a dense
 * conversion of a full-page illustration. */
const PREVIEW_POLL_INTERVAL_MS = 1000;
const PREVIEW_POLL_ATTEMPTS = 180;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

function readImageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.width, height: img.height });
    img.onerror = () => reject(new Error("could not decode image"));
    img.src = src;
  });
}

function isItemFinished(item: BatchItem): boolean {
  if (item.error !== null) return true;
  if (item.queued || item.status === null) return false;
  return TERMINAL_STATES.has(item.status.state);
}

function itemStateLabel(item: BatchItem): string {
  if (item.error) return "Error";
  if (item.queued) return "Waiting";
  if (!item.status) return "Submitting…";
  switch (item.status.state) {
    case "pending":
      return "Queued";
    case "running":
      return `${Math.round(item.status.fraction_complete * 100)}%`;
    case "succeeded":
      return "Done";
    case "failed":
      return "Failed";
    case "cancelled":
      return "Cancelled";
  }
}

function BatchItemTile({
  item,
  onOpen,
  onCancel,
}: Readonly<{
  item: BatchItem;
  onOpen: (id: string) => void;
  onCancel: (id: string) => void;
}>) {
  const succeeded = item.status?.state === "succeeded";
  const failed = item.error !== null || item.status?.state === "failed";
  const active = !item.queued && item.status !== null && !TERMINAL_STATES.has(item.status.state);
  const pct = item.status ? Math.round(item.status.fraction_complete * 100) : 0;

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-border">
      <button
        type="button"
        onClick={() => onOpen(item.id)}
        aria-label={`Open details for ${item.fileName}`}
        className="flex flex-col text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        <div className="flex aspect-square w-full items-center justify-center bg-surface">
          {succeeded && item.status ? (
            // eslint-disable-next-line @next/next/no-img-element -- external, dynamically-sized API-served image; next/image's optimizer doesn't apply
            <img
              src={downloadUrl(item.status.job_id, "preview_colored")}
              alt={`Colored preview of ${item.fileName}`}
              className="h-full w-full object-contain"
            />
          ) : (
            <span
              className={`px-2 text-center text-xs ${failed ? "text-red-600 dark:text-red-400" : "text-foreground/60"}`}
            >
              {itemStateLabel(item)}
            </span>
          )}
        </div>

        {active && (
          <div className="h-1 w-full bg-surface" aria-hidden="true">
            <div
              className="h-full bg-accent transition-[width] duration-300"
              style={{ width: `${pct}%` }}
            />
          </div>
        )}

        <p className="truncate px-2 py-1.5 text-xs" title={item.fileName}>
          {item.fileName}
        </p>
      </button>

      {(item.queued || active) && (
        <button
          type="button"
          onClick={() => onCancel(item.id)}
          className="border-t border-border px-2 py-1 text-xs text-foreground/60 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          Cancel
        </button>
      )}
    </div>
  );
}

function BatchItemModal({
  item,
  onClose,
  onCancel,
}: Readonly<{
  item: BatchItem;
  onClose: () => void;
  onCancel: (id: string) => void;
}>) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Details for ${item.fileName}`}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col gap-4 overflow-y-auto rounded-lg border border-border bg-background p-4 sm:p-6"
      >
        <div className="flex items-center justify-between gap-4">
          <h3 className="truncate text-sm font-semibold" title={item.fileName}>
            {item.fileName}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded border border-border hover:bg-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          >
            ✕
          </button>
        </div>

        {item.error && (
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">
            {item.error}
          </p>
        )}

        {item.queued && !item.error && (
          <p className="text-sm text-foreground/60">Waiting in queue…</p>
        )}

        {!item.queued && !item.status && !item.error && (
          <p className="text-sm text-foreground/60">Submitting…</p>
        )}

        {item.status && <JobProgress status={item.status} onCancel={() => onCancel(item.id)} />}

        {item.status?.state === "succeeded" && item.status.downloads && (
          <>
            <PreviewViewer jobId={item.status.job_id} />
            <DownloadButtons
              jobId={item.status.job_id}
              availableArtifacts={item.status.downloads}
            />
          </>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const batch = useBatchConvert();
  const pdfExport = useGeneratePdf();
  const zipExport = useGenerateZip();
  const importFolder = useImportFolder();
  const [importMode, setImportMode] = useState(false);
  const [openItemId, setOpenItemId] = useState<string | null>(null);
  const [addingMore, setAddingMore] = useState(false);
  const [introImages, setIntroImages] = useState<File[]>([]);
  const [outroImages, setOutroImages] = useState<File[]>([]);
  const [paletteBackgrounds, setPaletteBackgrounds] = useState<File[]>([]);
  const [captionsFileName, setCaptionsFileName] = useState<string | null>(null);
  const [artworkNames, setArtworkNames] = useState<Map<number, ArtworkName>>(new Map());
  const [style, setStyle] = useState<ConvertStyle>({ preset: "dense" });
  // Mask editor state: upload ảnh trước → preview line art + mask editor → convert
  const [maskEditorActive, setMaskEditorActive] = useState(false);
  const [maskEditorFile, setMaskEditorFile] = useState<File | null>(null);
  const [previewLineArt, setPreviewLineArt] = useState<string | null>(null);
  const [previewColored, setPreviewColored] = useState<string | null>(null);
  const [maskBitmap, setMaskBitmap] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewImageDimensions, setPreviewImageDimensions] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const batchStarted = batch.items.length > 0;
  const batchFinished = batchStarted && batch.items.every(isItemFinished);
  const doneCount = batch.items.filter(isItemFinished).length;
  const openItem = openItemId !== null ? batch.items.find((i) => i.id === openItemId) : undefined;
  const succeededItems = batch.items.filter(
    (item): item is BatchItem & { status: NonNullable<BatchItem["status"]> } =>
      item.status?.state === "succeeded",
  );

  const handleGeneratePdf = useCallback(() => {
    void pdfExport.generate(
      succeededItems.map((item) => ({ jobId: item.status.job_id, fileName: item.fileName })),
      { introImages, outroImages, paletteBackgrounds, artworkNames },
    );
  }, [pdfExport, succeededItems, introImages, outroImages, paletteBackgrounds, artworkNames]);

  const handleGenerateZip = useCallback(() => {
    void zipExport.generate(
      succeededItems.map((item) => ({ jobId: item.status.job_id, fileName: item.fileName })),
      { artworkNames },
    );
  }, [zipExport, succeededItems, artworkNames]);

  const handleImportFolderChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) importFolder.importFromFileList(files);
    },
    [importFolder],
  );

  const handleImportZipChange = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) void importFolder.importFromZip(file);
    },
    [importFolder],
  );

  const handleGeneratePdfFromImport = useCallback(() => {
    void importFolder.generatePdf({ introImages, outroImages, paletteBackgrounds, artworkNames });
  }, [importFolder, introImages, outroImages, paletteBackgrounds, artworkNames]);

  const handleIntroImagesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setIntroImages(Array.from(event.target.files ?? []));
  }, []);

  const handleOutroImagesChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setOutroImages(Array.from(event.target.files ?? []));
  }, []);

  const handlePaletteBackgroundsChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    setPaletteBackgrounds(Array.from(event.target.files ?? []));
  }, []);

  const handleCaptionsCsvChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      setCaptionsFileName(null);
      setArtworkNames(new Map());
      return;
    }
    setCaptionsFileName(file.name);
    void file.text().then((text) => setArtworkNames(parseArtworkNames(text)));
  }, []);

  const handleMaskEditorStart = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const file = files[0];
      setMaskEditorFile(file);
      setMaskEditorActive(true);
      setMaskBitmap(null);

      setPreviewError(null);
      setPreviewColored(null);
      setPreviewProgress(0);
      setPreviewLoading(true);

      // Canvas geometry comes from the upload itself -- the mask is resized to
      // the engine's working raster on decode, so only the aspect ratio has to
      // match, and the source's own dimensions guarantee that.
      const dataUrl = await readFileAsDataUrl(file);
      const { width, height } = await readImageSize(dataUrl);
      setPreviewImageDimensions({ width, height });
      setPreviewLineArt(dataUrl);

      // A throwaway unmasked "partial" run supplies the backdrop to paint on:
      // the colored preview shows exactly the region boundaries the mask will
      // be resolved against.
      try {
        const { job_id: jobId } = await submitConvert({ file, preset: "partial", seed: 0 });
        for (let attempt = 0; attempt < PREVIEW_POLL_ATTEMPTS; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, PREVIEW_POLL_INTERVAL_MS));
          const status = await getJobStatus(jobId);
          setPreviewProgress(status.fraction_complete);
          if (status.state === "succeeded") {
            setPreviewColored(downloadUrl(jobId, "preview_colored"));
            return;
          }
          if (status.state === "failed" || status.state === "cancelled") {
            throw new Error(status.error ?? `preview job ${status.state}`);
          }
        }
        throw new Error("preview timed out");
      } catch (error) {
        // Painting still works over the raw artwork; only the region preview is
        // lost, so degrade instead of blocking the user.
        setPreviewError(error instanceof Error ? error.message : String(error));
        setPreviewColored(dataUrl);
      } finally {
        setPreviewLoading(false);
      }
    },
    [],
  );

  const handleSubmit = useCallback(
    (files: File[]) => {
      setOpenItemId(null);
      // If mask editor should be used, start it instead
      if (style.preset === "partial") {
        void handleMaskEditorStart(files);
      } else {
        batch.submit(files, style);
      }
    },
    [batch, style, handleMaskEditorStart],
  );

  const handleMaskSubmit = useCallback(() => {
    // The painted mask is the only way to choose the blank areas, so a run
    // without one is not a thing to fall back for -- the button is disabled.
    if (!maskEditorFile || !maskBitmap) return;
    setMaskEditorActive(false);
    batch.submit([maskEditorFile], { ...style, maskBitmap });
  }, [batch, style, maskEditorFile, maskBitmap]);

  const handleAddMore = useCallback(
    (files: File[]) => {
      setAddingMore(false);
      batch.addFiles(files, style);
    },
    [batch, style],
  );

  const handleStartOver = useCallback(() => {
    setOpenItemId(null);
    setAddingMore(false);
    batch.reset();
  }, [batch]);

  const handleCloseModal = useCallback(() => setOpenItemId(null), []);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mystery Color-by-Number</h1>
          <p className="text-sm text-foreground/60">
            Upload photos to generate printable color-by-number pages.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-col gap-6">
        {importMode ? (
          <section aria-labelledby="import-heading" className="flex flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 id="import-heading" className="text-lg font-semibold">
                Import outline/colored/palette
              </h2>
              <button
                type="button"
                onClick={() => {
                  setImportMode(false);
                  importFolder.reset();
                }}
                className="text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ← Back to conversion
              </button>
            </div>

            {importFolder.items.length === 0 ? (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Import ZIP file</span>
                  <input type="file" accept=".zip" onChange={handleImportZipChange} className="text-xs" />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Or import an extracted folder</span>
                  <input
                    type="file"
                    multiple
                    ref={(el) => {
                      if (el) el.setAttribute("webkitdirectory", "true");
                    }}
                    onChange={handleImportFolderChange}
                    className="text-xs"
                  />
                </label>
              </div>
            ) : (
              <>
                <p className="text-sm text-foreground/70">
                  {importFolder.items.length} item(s) matched — ready to export, no conversion needed.
                </p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="flex flex-col gap-1">
                    <span className="text-foreground/70">Intro pages (before content)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleIntroImagesChange}
                      className="text-xs"
                    />
                    {introImages.length > 0 && (
                      <span className="text-xs text-foreground/60">{introImages.length} image(s) selected</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-foreground/70">Outro pages (after content)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handleOutroImagesChange}
                      className="text-xs"
                    />
                    {outroImages.length > 0 && (
                      <span className="text-xs text-foreground/60">{outroImages.length} image(s) selected</span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-foreground/70">Palette backgrounds (cycled per item)</span>
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={handlePaletteBackgroundsChange}
                      className="text-xs"
                    />
                    {paletteBackgrounds.length > 0 && (
                      <span className="text-xs text-foreground/60">
                        {paletteBackgrounds.length} image(s) selected
                      </span>
                    )}
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-foreground/70">Artwork names CSV (header &quot;text&quot;, rows &quot;N. Name: action&quot;)</span>
                    <input type="file" accept=".csv" onChange={handleCaptionsCsvChange} className="text-xs" />
                    {captionsFileName && (
                      <span className="text-xs text-foreground/60">
                        {captionsFileName} — {artworkNames.size} name(s)
                      </span>
                    )}
                  </label>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGeneratePdfFromImport}
                    disabled={importFolder.generating}
                    className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {importFolder.generating
                      ? `Generating PDF… ${importFolder.progress?.done ?? 0}/${importFolder.progress?.total ?? importFolder.items.length}`
                      : "Generate PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={importFolder.reset}
                    className="rounded border border-border px-4 py-2 text-sm hover:bg-surface"
                  >
                    Start over
                  </button>
                </div>
              </>
            )}

            {importFolder.error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {importFolder.error}
              </p>
            )}
          </section>
        ) : maskEditorActive && previewLineArt && previewImageDimensions ? (
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Draw areas to leave white (uncolored)</h2>

            {previewLoading && (
              <p className="text-sm text-foreground/70" aria-live="polite">
                Rendering the colored preview… {Math.round(previewProgress * 100)}% — you can start
                painting now on the original artwork; the backdrop swaps in when it is ready
                (strokes are kept).
              </p>
            )}
            {previewError && (
              <p role="alert" className="text-sm text-amber-600 dark:text-amber-400">
                Colored preview unavailable ({previewError}) — painting over the original artwork
                instead.
              </p>
            )}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <h3 className="mb-2 text-sm font-semibold">Draw mask</h3>
                <MaskEditor
                  imageUrl={previewColored ?? previewLineArt}
                  imageWidth={previewImageDimensions.width}
                  imageHeight={previewImageDimensions.height}
                  onMaskChange={setMaskBitmap}
                />
              </div>
              <div>
                <h3 className="mb-2 text-sm font-semibold">Preview</h3>
                <PreviewCanvas
                  coloredPreviewUrl={previewColored ?? previewLineArt}
                  maskBase64={maskBitmap}
                  width={previewImageDimensions.width}
                  height={previewImageDimensions.height}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setMaskEditorActive(false);
                  setMaskEditorFile(null);
                  setPreviewLineArt(null);
                  setPreviewColored(null);
                  setMaskBitmap(null);
                  setPreviewError(null);
                  setPreviewLoading(false);
                  setPreviewProgress(0);
                }}
                className="rounded border border-border px-4 py-2 text-sm hover:bg-surface"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleMaskSubmit}
                disabled={!maskBitmap}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Convert with mask
              </button>
              {!maskBitmap && (
                <p className="self-center text-sm text-foreground/60">
                  Paint at least one area to leave blank.
                </p>
              )}
            </div>
          </section>
        ) : (
          <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
            <h2 id="upload-heading" className="sr-only">
              Upload
            </h2>
            {!batchStarted && !importMode ? (
              <>
                <StyleSelector style={style} onChange={setStyle} />
                <Uploader onSubmit={handleSubmit} />
                <button
                  type="button"
                  onClick={() => setImportMode(true)}
                  className="self-start text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                >
                  Or import a previously exported ZIP/folder →
                </button>
              </>
            ) : addingMore ? (
              <Uploader onSubmit={handleAddMore} />
            ) : (
              <div className="flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => setAddingMore(true)}
                className="self-start text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                + Add more photos
              </button>
              <button
                type="button"
                onClick={handleStartOver}
                className="self-start text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                ← Start a new conversion
              </button>
            </div>
            )}
          </section>
        )}

        {batchStarted && (
          <section aria-labelledby="progress-heading" className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="progress-heading" className="text-sm font-semibold">
                {batchFinished
                  ? `Finished ${doneCount} of ${batch.items.length}`
                  : `Converting… ${doneCount} of ${batch.items.length} done`}
              </h2>
              {batchFinished && succeededItems.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleGeneratePdf}
                    disabled={pdfExport.generating}
                    className="inline-flex items-center justify-center rounded-md bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {pdfExport.generating
                      ? `Generating PDF… ${pdfExport.progress?.done ?? 0}/${pdfExport.progress?.total ?? succeededItems.length}`
                      : "Generate PDF"}
                  </button>
                  <button
                    type="button"
                    onClick={handleGenerateZip}
                    disabled={zipExport.generating}
                    className="inline-flex items-center justify-center rounded-md border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-surface disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    {zipExport.generating
                      ? `Exporting ZIP… ${zipExport.progress?.done ?? 0}/${zipExport.progress?.total ?? succeededItems.length}`
                      : "Export ZIP (outline/colored/palette)"}
                  </button>
                </div>
              )}
            </div>
            {zipExport.error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {zipExport.error}
              </p>
            )}
            {batchFinished && succeededItems.length > 0 && (
              <div className="flex flex-wrap gap-4 text-sm">
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Intro pages (before content)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleIntroImagesChange}
                    className="text-xs"
                  />
                  {introImages.length > 0 && (
                    <span className="text-xs text-foreground/60">{introImages.length} image(s) selected</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Outro pages (after content)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handleOutroImagesChange}
                    className="text-xs"
                  />
                  {outroImages.length > 0 && (
                    <span className="text-xs text-foreground/60">{outroImages.length} image(s) selected</span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Palette backgrounds (cycled per item)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    onChange={handlePaletteBackgroundsChange}
                    className="text-xs"
                  />
                  {paletteBackgrounds.length > 0 && (
                    <span className="text-xs text-foreground/60">
                      {paletteBackgrounds.length} image(s) selected
                    </span>
                  )}
                </label>
                <label className="flex flex-col gap-1">
                  <span className="text-foreground/70">Artwork names CSV (header &quot;text&quot;, rows &quot;N. Name: action&quot;)</span>
                  <input type="file" accept=".csv" onChange={handleCaptionsCsvChange} className="text-xs" />
                  {captionsFileName && (
                    <span className="text-xs text-foreground/60">
                      {captionsFileName} — {artworkNames.size} name(s)
                    </span>
                  )}
                </label>
              </div>
            )}
            {pdfExport.error && (
              <p role="alert" className="text-sm text-red-600 dark:text-red-400">
                {pdfExport.error}
              </p>
            )}
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
              {batch.items.map((item) => (
                <li key={item.id}>
                  <BatchItemTile
                    item={item}
                    onOpen={setOpenItemId}
                    onCancel={batch.cancelItem}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>

      {openItem && (
        <BatchItemModal item={openItem} onClose={handleCloseModal} onCancel={batch.cancelItem} />
      )}
    </div>
  );
}
