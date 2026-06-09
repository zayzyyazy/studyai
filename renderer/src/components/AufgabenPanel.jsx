import React, { useState, useEffect, useCallback } from 'react';
import LectureMarkdown from './LectureMarkdown';

const DIFFICULTY_STYLE = {
  easy: 'text-green-400 bg-green-400/10',
  medium: 'text-yellow-400 bg-yellow-400/10',
  hard: 'text-orange-400 bg-orange-400/10',
};

const STATUS_CYCLE = { open: 'attempted', attempted: 'done', done: 'open' };

export default function AufgabenPanel({
  lecturePath,
  initialAufgaben,
  initialProgress = {},
  initialMarkdown = '',
  isGerman = true,
  onAufgabenUpdated,
}) {
  const [aufgaben, setAufgaben] = useState(initialAufgaben);
  const [markdownFallback, setMarkdownFallback] = useState(initialMarkdown);
  const [progress, setProgress] = useState(initialProgress);
  const [expandedId, setExpandedId] = useState(null);
  const [showSolution, setShowSolution] = useState({});
  const [showHints, setShowHints] = useState({});
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');

  const reload = useCallback(async () => {
    if (!lecturePath) return;
    setLoading(true);
    setError('');
    const res = await window.api.loadAufgaben({ lecturePath });
    setLoading(false);
    if (!res?.success) {
      setAufgaben(null);
      setError(res?.error || '');
      return;
    }
    setAufgaben(res.aufgaben);
    setMarkdownFallback(res.markdown || '');
    setProgress(res.progress || {});
    onAufgabenUpdated?.(res.aufgaben);
  }, [lecturePath, onAufgabenUpdated]);

  useEffect(() => {
    if (initialAufgaben?.exercises?.length) {
      setAufgaben(initialAufgaben);
      setProgress(initialProgress || {});
      if (initialAufgaben.exercises[0]) setExpandedId(initialAufgaben.exercises[0].id);
      return;
    }
    reload();
  }, [lecturePath]);

  const persistProgress = async (next) => {
    setProgress(next);
    await window.api.saveAufgabenProgress({ lecturePath, progress: next });
  };

  const toggleStatus = (id) => {
    const next = { ...progress, [id]: STATUS_CYCLE[progress[id] || 'open'] || 'attempted' };
    persistProgress(next);
  };

  const generate = async () => {
    if (!lecturePath) return;
    setGenerating(true);
    setError('');
    const res = await window.api.generateAufgaben({ lecturePath });
    setGenerating(false);
    if (!res?.success) {
      setError(res?.error || (isGerman ? 'Generierung fehlgeschlagen' : 'Generation failed'));
      return;
    }
    setAufgaben(res.aufgaben);
    setMarkdownFallback('');
    if (res.aufgaben?.exercises?.[0]) setExpandedId(res.aufgaben.exercises[0].id);
    onAufgabenUpdated?.(res.aufgaben);
    await persistProgress(progress);
  };

  const exercises = aufgaben?.exercises || [];
  const doneCount = exercises.filter((ex) => progress[ex.id] === 'done').length;

  if (loading) {
    return <p className="text-sm text-text-muted py-8 text-center">{isGerman ? 'Lade Aufgaben…' : 'Loading exercises…'}</p>;
  }

  if (!exercises.length) {
    return (
      <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-6 text-center space-y-3">
        <p className="text-3xl">📝</p>
        <p className="text-sm text-text-primary font-medium">
          {isGerman ? 'Noch keine Aufgaben für diese Vorlesung' : 'No exercises for this lecture yet'}
        </p>
        <p className="text-xs text-text-muted max-w-md mx-auto">
          {isGerman
            ? 'Beim PDF-Import werden Übungsaufgaben erstellt. Für ältere Vorlesungen kannst du sie hier nachgenerieren.'
            : 'Exercises are created on PDF import. For older lectures, generate them here.'}
        </p>
        {markdownFallback?.trim() && (
          <div className="text-left markdown-body max-w-3xl mx-auto pt-2">
            <LectureMarkdown>{markdownFallback}</LectureMarkdown>
          </div>
        )}
        {error && <p className="text-xs text-red-400">{error}</p>}
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40"
        >
          {generating ? (isGerman ? 'Erstelle…' : 'Generating…') : (isGerman ? 'Aufgaben generieren' : 'Generate exercises')}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-text-primary">
            {isGerman ? 'Aufgaben' : 'Exercises'}
          </p>
          <p className="text-xs text-text-muted mt-0.5">
            {isGerman
              ? `${doneCount}/${exercises.length} erledigt · erst lösen, dann Lösung anzeigen`
              : `${doneCount}/${exercises.length} done · solve first, then reveal solution`}
          </p>
        </div>
        <button
          type="button"
          onClick={generate}
          disabled={generating}
          className="text-xs px-3 py-1.5 rounded-lg border border-border-DEFAULT hover:bg-bg-hover disabled:opacity-40"
        >
          {generating ? '…' : (isGerman ? 'Neu generieren' : 'Regenerate')}
        </button>
      </div>

      <div className="space-y-2">
        {exercises.map((ex, idx) => {
          const open = expandedId === ex.id;
          const status = progress[ex.id] || 'open';
          const diffClass = DIFFICULTY_STYLE[ex.difficulty] || DIFFICULTY_STYLE.medium;
          return (
            <div
              key={ex.id}
              className={`rounded-xl border overflow-hidden transition-colors
                ${open ? 'border-accent/35 bg-bg-secondary' : 'border-border-DEFAULT bg-bg-secondary/80'}`}
            >
              <button
                type="button"
                onClick={() => setExpandedId(open ? null : ex.id)}
                className="w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-bg-hover/40"
              >
                <span className="text-xs font-bold text-accent tabular-nums w-6 flex-shrink-0 pt-0.5">
                  {idx + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5 mb-1">
                    <span className="text-sm font-semibold text-text-primary">{ex.title}</span>
                    {ex.typeLabel && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted">{ex.typeLabel}</span>
                    )}
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${diffClass}`}>{ex.difficulty}</span>
                    {status === 'done' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-400/15 text-green-400">{isGerman ? 'Erledigt' : 'Done'}</span>
                    )}
                    {status === 'attempted' && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent/15 text-accent">{isGerman ? 'Versucht' : 'Attempted'}</span>
                    )}
                  </div>
                  {ex.topic && <p className="text-[10px] text-text-muted">{ex.topic}</p>}
                </div>
                <span className="text-text-muted text-xs flex-shrink-0">{open ? '▾' : '▸'}</span>
              </button>

              {open && (
                <div className="px-4 pb-4 pt-0 border-t border-border-subtle/60 space-y-3">
                  <div className="markdown-body">
                    <LectureMarkdown>{ex.prompt}</LectureMarkdown>
                  </div>

                  {ex.hints?.length > 0 && (
                    <div>
                      <button
                        type="button"
                        onClick={() => setShowHints((p) => ({ ...p, [ex.id]: !p[ex.id] }))}
                        className="text-xs text-accent hover:underline"
                      >
                        {showHints[ex.id]
                          ? (isGerman ? 'Hinweise ausblenden' : 'Hide hints')
                          : (isGerman ? 'Hinweis anzeigen' : 'Show hint')}
                      </button>
                      {showHints[ex.id] && (
                        <ul className="mt-2 space-y-1 text-xs text-text-secondary list-disc list-inside">
                          {ex.hints.map((h, i) => (
                            <li key={i}>{h}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => toggleStatus(ex.id)}
                      className="text-xs px-3 py-1.5 rounded-lg border border-border-DEFAULT hover:bg-bg-hover"
                    >
                      {status === 'done'
                        ? (isGerman ? '↩ Wieder offen' : '↩ Reopen')
                        : status === 'attempted'
                          ? (isGerman ? '✓ Als erledigt' : '✓ Mark done')
                          : (isGerman ? 'Habe versucht' : 'I tried this')}
                    </button>
                    {ex.solution && (
                      <button
                        type="button"
                        onClick={() => setShowSolution((p) => ({ ...p, [ex.id]: !p[ex.id] }))}
                        className="text-xs px-3 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25"
                      >
                        {showSolution[ex.id]
                          ? (isGerman ? 'Lösung verbergen' : 'Hide solution')
                          : (isGerman ? 'Lösung anzeigen' : 'Show solution')}
                      </button>
                    )}
                  </div>

                  {showSolution[ex.id] && ex.solution && (
                    <div className="rounded-lg bg-bg-tertiary/80 border border-border-subtle p-3 markdown-body">
                      <p className="text-[10px] uppercase tracking-wide text-text-muted mb-2 font-semibold">
                        {isGerman ? 'Lösung' : 'Solution'}
                      </p>
                      <LectureMarkdown>{ex.solution}</LectureMarkdown>
                    </div>
                  )}

                  {ex.checkQuestion && (
                    <p className="text-xs text-text-muted border-t border-border-subtle pt-2">
                      <span className="font-medium text-text-secondary">{isGerman ? 'Selbstcheck: ' : 'Self-check: '}</span>
                      {ex.checkQuestion}
                    </p>
                  )}

                  {ex.sourceNote && (
                    <p className="text-[10px] text-text-muted italic">{ex.sourceNote}</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
