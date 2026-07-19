"use client";

import { useCallback, useState } from "react";
import { DownloadButtons } from "@/components/DownloadButtons";
import { JobHistoryList } from "@/components/JobHistoryList";
import { JobProgress } from "@/components/JobProgress";
import { PreviewViewer } from "@/components/PreviewViewer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Uploader } from "@/components/Uploader";
import { useConvertJob } from "@/hooks/useConvertJob";
import { useJobHistory } from "@/hooks/useJobHistory";
import { useJobStatus } from "@/hooks/useJobStatus";

export default function Home() {
  const activeJob = useConvertJob();
  const history = useJobHistory();
  const [historyJobId, setHistoryJobId] = useState<string | null>(null);
  const historyJob = useJobStatus(historyJobId);

  // Selecting a history entry views that job instead of the live submit flow.
  const viewingHistory = historyJobId !== null;
  const displayedStatus = viewingHistory ? historyJob.status : activeJob.status;
  const displayedError = viewingHistory ? historyJob.error : activeJob.submitError;

  const handleSubmit = useCallback(
    (file: File) => {
      setHistoryJobId(null);
      void activeJob.submit(file);
    },
    [activeJob],
  );

  const handleSelectHistory = useCallback((jobId: string) => {
    setHistoryJobId(jobId);
  }, []);

  const handleStartOver = useCallback(() => {
    setHistoryJobId(null);
    activeJob.reset();
  }, [activeJob]);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-4 py-8 sm:px-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">Mystery Color-by-Number</h1>
          <p className="text-sm text-foreground/60">
            Upload a photo to generate a printable color-by-number page.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <main className="flex flex-col gap-6">
        <section aria-labelledby="upload-heading" className="flex flex-col gap-4">
          <h2 id="upload-heading" className="sr-only">
            Upload
          </h2>
          {!displayedStatus || displayedStatus.state === "failed" || displayedStatus.state === "cancelled" ? (
            <Uploader disabled={activeJob.submitting} onSubmit={handleSubmit} />
          ) : (
            <button
              type="button"
              onClick={handleStartOver}
              className="self-start text-sm text-foreground/70 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              ← Start a new conversion
            </button>
          )}

          {displayedError && (
            <p role="alert" className="text-sm text-red-600 dark:text-red-400">
              {displayedError}
            </p>
          )}
        </section>

        {displayedStatus && (
          <section aria-labelledby="progress-heading" className="flex flex-col gap-4">
            <h2 id="progress-heading" className="sr-only">
              Conversion status
            </h2>
            <JobProgress status={displayedStatus} onCancel={activeJob.cancel} />

            {displayedStatus.state === "succeeded" && displayedStatus.downloads && (
              <>
                <PreviewViewer jobId={displayedStatus.job_id} />
                <DownloadButtons
                  jobId={displayedStatus.job_id}
                  availableArtifacts={displayedStatus.downloads}
                />
              </>
            )}
          </section>
        )}

        <section aria-labelledby="history-heading" className="flex flex-col gap-3 border-t border-border pt-6">
          <div className="flex items-center justify-between">
            <h2 id="history-heading" className="text-sm font-semibold">
              Job history
            </h2>
            {history.entries.length > 0 && (
              <button
                type="button"
                onClick={history.clear}
                className="text-xs text-foreground/60 underline decoration-dotted hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
              >
                Clear all
              </button>
            )}
          </div>
          <JobHistoryList
            entries={history.entries}
            onSelect={handleSelectHistory}
            onRemove={history.remove}
          />
        </section>
      </main>
    </div>
  );
}
