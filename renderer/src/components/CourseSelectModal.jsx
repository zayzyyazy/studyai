import React, { useEffect, useState } from 'react';

export default function CourseSelectModal({
  courses,
  files = [],
  fileName,
  suggestion,
  preferredCourse,
  onConfirm,
  onCancel,
}) {
  const [selected, setSelected] = useState(preferredCourse || suggestion?.suggestedCourse || courses[0] || null);
  const isBatch = files.length > 1;
  const displayName = fileName || files[0]?.name;

  useEffect(() => {
    setSelected(preferredCourse || suggestion?.suggestedCourse || courses[0] || null);
  }, [suggestion, preferredCourse, courses]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-bg-secondary border border-border-DEFAULT rounded-2xl p-6 w-full max-w-md mx-4 animate-fade-in shadow-2xl max-h-[85vh] flex flex-col">
        <div className="text-3xl mb-3">{isBatch ? '📚' : '📄'}</div>
        <h2 className="text-lg font-semibold text-text-primary mb-1">
          {isBatch ? `Add ${files.length} lectures` : 'Assign to course'}
        </h2>
        <p className="text-text-muted text-sm mb-4">
          {isBatch ? (
            <>All PDFs will be processed one after another into the same course.</>
          ) : (
            <span className="text-text-secondary truncate block">{displayName}</span>
          )}
        </p>

        {isBatch && (
          <ul className="mb-4 max-h-36 overflow-y-auto rounded-lg border border-border-DEFAULT bg-bg-tertiary divide-y divide-border-subtle text-xs">
            {files.map((f) => (
              <li key={f.path} className="px-3 py-2 text-text-secondary truncate">{f.name}</li>
            ))}
          </ul>
        )}

        {suggestion?.suggestedCourse && !isBatch && (
          <div className="mb-4 text-xs rounded-lg border border-accent/30 bg-accent/10 px-3 py-2 text-text-secondary">
            {preferredCourse ? 'Dropped inside' : 'Smart placement suggests'}{' '}
            <span className="text-text-primary font-semibold">
              {suggestion.suggestedCourse.emoji} {suggestion.suggestedCourse.name}
            </span>
            {typeof suggestion.confidence === 'number' ? ` (${suggestion.confidence})` : ''}.
          </div>
        )}

        {suggestion?.suggestedLectureName && !isBatch && (
          <div className="mb-4 text-xs rounded-lg border border-border-DEFAULT bg-bg-tertiary px-3 py-2 text-text-muted">
            Suggested title: <span className="text-text-secondary">{suggestion.suggestedLectureName}</span>
          </div>
        )}

        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wide mb-2">
          Course
        </label>
        <select
          value={selected?.id || ''}
          onChange={(e) => setSelected(courses.find((c) => c.id === e.target.value))}
          className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-xl px-4 py-3 text-text-primary text-sm focus:outline-none focus:border-accent mb-6"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>{c.emoji} {c.name}</option>
          ))}
        </select>

        <div className="flex gap-3 mt-auto">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-xl border border-border-DEFAULT text-text-secondary hover:bg-bg-hover text-sm"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => selected && onConfirm(selected)}
            disabled={!selected}
            className="flex-1 py-2.5 rounded-xl bg-accent text-white font-semibold text-sm disabled:opacity-40"
          >
            {isBatch ? `Process ${files.length} PDFs →` : 'Process →'}
          </button>
        </div>
      </div>
    </div>
  );
}
