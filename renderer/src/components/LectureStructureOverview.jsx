import React from 'react';
import LectureMarkdown from './LectureMarkdown';
import {
  getFocusTheme,
  getCoreThemes,
  getTopicTree,
  getPrerequisites,
  getRecurringThemes,
  getThreadContext,
  getCourseSequence,
  isGermanLecture,
} from '../utils/lectureStructure';

export default function LectureStructureOverview({ lecture }) {
  const focus = getFocusTheme(lecture);
  const core = getCoreThemes(lecture);
  const tree = getTopicTree(lecture);
  const prereqs = getPrerequisites(lecture);
  const recurring = getRecurringThemes(lecture);
  const thread = getThreadContext(lecture);
  const seq = getCourseSequence(lecture);
  const de = isGermanLecture(lecture);
  const hasStructure = !!(focus || core.length || tree.length || seq);

  return (
    <div className="space-y-5">
      {hasStructure && (
        <div className="rounded-xl border border-accent/25 bg-accent/5 p-4 space-y-4">
          {seq && (
            <div className="rounded-lg bg-bg-tertiary/80 px-3 py-2.5 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-accent font-semibold">
                {de ? 'Stelle im Kurs' : 'Place in course'}
              </p>
              <p className="text-sm font-semibold text-text-primary">
                {seq.label}{seq.total ? ` · ${seq.total} ${de ? 'Vorlesungen' : 'lectures'}` : ''}
              </p>
              {seq.buildsOn && <p className="text-xs text-text-secondary">{seq.buildsOn}</p>}
              {seq.previousName && (
                <p className="text-[10px] text-text-muted">
                  {de ? 'Davor' : 'Before'}: {seq.previousName}
                </p>
              )}
              {thread?.courseArc?.length > 1 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {thread.courseArc.map((item) => (
                    <span
                      key={item.id}
                      className={`text-[10px] px-1.5 py-0.5 rounded ${item.active ? 'bg-accent text-white' : 'bg-bg-hover text-text-muted'}`}
                    >
                      {item.index}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}
          {focus && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-accent font-semibold mb-1">
                {de ? 'Fokusthema' : 'Focus theme'}
              </p>
              <p className="text-base font-semibold text-text-primary">{focus}</p>
            </div>
          )}
          {core.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                {de ? 'Kernthemen' : 'Core themes'}
              </p>
              <div className="flex flex-wrap gap-1.5">
                {core.map((t) => (
                  <span key={t} className="text-xs px-2.5 py-1 rounded-lg bg-bg-tertiary border border-border-DEFAULT text-text-primary">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}
          {tree.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                {de ? 'Aufbau' : 'Structure'}
              </p>
              <ul className="space-y-2">
                {tree.map((theme) => (
                  <li key={theme.id || theme.label} className="text-sm">
                    <span className="text-text-primary font-medium">{theme.label}</span>
                    {theme.subtopics?.length > 0 && (
                      <ul className="mt-1 ml-3 space-y-0.5">
                        {theme.subtopics.map((sub) => (
                          <li key={sub} className="text-xs text-text-muted">· {sub}</li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {prereqs.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-1">
                {de ? 'Zuerst verstehen' : 'Understand first'}
              </p>
              <ul className="text-xs text-text-secondary space-y-0.5">
                {prereqs.slice(0, 5).map((p, i) => (
                  <li key={i}>· {typeof p === 'string' ? p : p.label || p.topic || JSON.stringify(p)}</li>
                ))}
              </ul>
            </div>
          )}
          {recurring.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-1">
                {de ? 'Wiederkehrend im Kurs' : 'Recurring in course'}
              </p>
              <ul className="text-xs text-text-secondary space-y-1">
                {recurring.slice(0, 4).map((r) => (
                  <li key={r.label}>
                    <span className="text-text-primary">{r.label}</span>
                    {r.hits?.[0] && (
                      <span className="text-text-muted"> — {r.hits[0].lectureName}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {thread?.summary && (
            <p className="text-xs text-text-muted border-t border-border-subtle pt-3">{thread.summary}</p>
          )}
        </div>
      )}

      <div>
        <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
          {de ? 'Vorlesungskarte' : 'Lecture map'}
        </p>
        <LectureMarkdown>
          {lecture?.overview || (de ? '*Noch keine Übersicht. „Regenerate“ erzeugt eine Karte.*' : '*No overview yet. Click Regenerate.*')}
        </LectureMarkdown>
      </div>
    </div>
  );
}
