import React from 'react';

const STEPS = [
  { key: 'starting', label: 'Starting…', icon: '⏳' },
  { key: 'extracting', label: 'Extracting text from PDF', icon: '📄' },
  { key: 'analyzing', label: 'Understanding lecture structure', icon: '🧭' },
  { key: 'summary', label: 'Generating adaptive summary', icon: '✍️' },
  { key: 'concepts', label: 'Extracting key concepts', icon: '🧠' },
  { key: 'overview', label: 'Building map / overview', icon: '🗺️' },
  { key: 'quiz', label: 'Generating recall questions', icon: '❓' },
  { key: 'naming', label: 'Pruning & naming study topics', icon: '✨' },
  { key: 'writing', label: 'Writing files to vault', icon: '💾' },
  { key: 'done', label: 'Processing complete!', icon: '✅' }
];

export default function ProcessingModal({
  processing,
  onDismiss,
  onRetry,
  onSkipBatch,
  onStopBatch,
}) {
  const { file, course, status, error, batch } = processing;
  const currentStepIndex = STEPS.findIndex((s) => s.key === status?.step);
  const isDone = status?.step === 'done';
  const isBatch = batch && batch.total > 1;
  const batchIndex = batch?.current ?? 1;
  const batchTotal = batch?.total ?? 1;

  if (error) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-bg-secondary border border-border-DEFAULT rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
          <div className="text-3xl mb-3">⚠️</div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">
            {isBatch ? `Failed (${batchIndex}/${batchTotal})` : 'Processing failed'}
          </h2>
          <p className="text-xs text-text-muted mb-2 truncate">{file?.name}</p>

          {error.error === 'SCANNED_PDF' ? (
            <p className="text-text-secondary text-sm mb-5">
              Scanned PDF — text extraction failed. Use a text-based PDF.
            </p>
          ) : error.error === 'API_ERROR' ? (
            <div className="mb-5">
              <p className="bg-bg-tertiary text-red-400 text-xs font-mono rounded-lg p-3">{error.message}</p>
            </div>
          ) : (
            <p className="text-text-secondary text-sm mb-5">{error.message || 'Unexpected error.'}</p>
          )}

          {isBatch && batch.completed?.length > 0 && (
            <p className="text-xs text-green-400 mb-3">{batch.completed.length} lecture(s) already imported.</p>
          )}

          <div className="flex flex-col gap-2">
            {isBatch && onSkipBatch && (
              <button
                type="button"
                onClick={onSkipBatch}
                className="w-full py-2.5 rounded-xl bg-accent text-white text-sm font-semibold"
              >
                Skip & continue batch
              </button>
            )}
            <div className="flex gap-3">
              <button type="button" onClick={onDismiss} className="flex-1 py-2.5 rounded-xl border border-border-DEFAULT text-sm">
                {isBatch && onStopBatch ? 'Stop batch' : 'Dismiss'}
              </button>
              {error.error === 'API_ERROR' && (
                <button type="button" onClick={onRetry} className="flex-1 py-2.5 rounded-xl bg-accent text-white text-sm font-semibold">
                  Retry
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (batch?.finished) {
    const ok = batch.completed?.length || 0;
    const fail = batch.failed?.length || 0;
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
        <div className="bg-bg-secondary border border-border-DEFAULT rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
          <div className="text-3xl mb-3">✅</div>
          <h2 className="text-lg font-semibold text-text-primary mb-2">Batch complete</h2>
          <p className="text-sm text-text-secondary mb-4">
            <span className="text-green-400 font-medium">{ok}</span> lecture{ok !== 1 ? 's' : ''} added
            {fail > 0 && <>, <span className="text-red-400">{fail} failed</span></>}
          </p>
          {batch.completed?.length > 0 && (
            <ul className="text-xs text-text-secondary mb-4 max-h-32 overflow-y-auto space-y-1">
              {batch.completed.map((c) => (
                <li key={c.name} className="truncate">✓ {c.lectureName || c.name}</li>
              ))}
            </ul>
          )}
          {batch.failed?.length > 0 && (
            <ul className="text-xs text-text-muted mb-4 max-h-24 overflow-y-auto">
              {batch.failed.map((f) => (
                <li key={f.path} className="truncate">✗ {f.name}</li>
              ))}
            </ul>
          )}
          <button type="button" onClick={onDismiss} className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold text-sm">
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-secondary border border-border-DEFAULT rounded-2xl p-6 w-full max-w-sm mx-4 shadow-2xl">
        <div className="flex items-center gap-3 mb-4">
          <div className={`w-8 h-8 rounded-full border-2 border-accent border-t-transparent ${isDone ? '' : 'animate-spin'}`}
            style={isDone ? { border: '2px solid #6366f1' } : {}} />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">
              {isBatch ? `Processing ${batchIndex} of ${batchTotal}` : 'Processing PDF'}
            </h2>
            <p className="text-text-muted text-xs truncate">{file?.name}</p>
          </div>
        </div>

        {isBatch && (
          <div className="mb-4">
            <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all"
                style={{ width: `${Math.round(((batchIndex - 1) / batchTotal) * 100)}%` }}
              />
            </div>
            {batch.completed?.length > 0 && (
              <p className="text-[10px] text-text-muted mt-1">{batch.completed.length} done so far</p>
            )}
          </div>
        )}

        <div className="space-y-2 mb-4 max-h-48 overflow-y-auto">
          {STEPS.slice(0, -1).map((step, i) => {
            const stepDone = i < currentStepIndex || status?.step === 'done';
            const stepActive = i === currentStepIndex;
            return (
              <div key={step.key} className={`flex items-center gap-3 ${stepActive || stepDone ? 'opacity-100' : 'opacity-30'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-xs
                  ${stepDone ? 'bg-green-500' : stepActive ? 'bg-accent animate-pulse' : 'bg-bg-tertiary'}`}>
                  {stepDone ? '✓' : stepActive ? '•' : ''}
                </div>
                <span className={`text-sm ${stepActive ? 'font-medium text-text-primary' : 'text-text-muted'}`}>
                  {step.icon} {step.label}
                </span>
              </div>
            );
          })}
        </div>

        <p className="text-text-muted text-xs">
          → <span className="text-accent font-medium">{course?.emoji} {course?.name}</span>
        </p>
        {isBatch && onStopBatch && (
          <button type="button" onClick={onStopBatch} className="mt-3 text-xs text-text-muted hover:text-text-primary">
            Stop batch
          </button>
        )}
      </div>
    </div>
  );
}
