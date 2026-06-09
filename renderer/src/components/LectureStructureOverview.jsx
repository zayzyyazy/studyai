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
  getStudyPath,
  isGermanLecture,
} from '../utils/lectureStructure';

function resolveLinkLecture(lectures, link) {
  if (!link) return null;
  const path = link.priorLecturePath || link.path;
  const id = link.priorLectureId || link.id;
  if (!path && !id) return null;
  const found = (lectures || []).find((l) => (path && l.path === path) || (id && l.id === id));
  if (found) return found;
  if (!path) return null;
  return {
    id: id || path.split('/').pop(),
    path,
    name: link.priorLectureName || link.name || 'Lecture',
  };
}

export default function LectureStructureOverview({ lecture, lectures = [], onStudyStep, onOpenLecture }) {
  const focus = getFocusTheme(lecture);
  const core = getCoreThemes(lecture);
  const tree = getTopicTree(lecture);
  const prereqs = getPrerequisites(lecture);
  const recurring = getRecurringThemes(lecture);
  const thread = getThreadContext(lecture);
  const seq = getCourseSequence(lecture);
  const studyPath = getStudyPath(lecture);
  const de = isGermanLecture(lecture);
  const hasStructure = !!(focus || core.length || tree.length || seq || studyPath?.units?.length);

  const openLink = (link) => {
    const lec = resolveLinkLecture(lectures, link);
    if (lec && onOpenLecture) onOpenLecture(lec, { tab: link.tab || 'overview' });
  };

  const openPrior = () => {
    if (!seq?.previousPath && !seq?.previousId) return;
    openLink({
      priorLecturePath: seq.previousPath,
      priorLectureId: seq.previousId,
      priorLectureName: seq.previousName,
      tab: 'overview',
    });
  };

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
                  {de ? 'Davor' : 'Before'}:{' '}
                  {(seq.previousPath || seq.previousId) && onOpenLecture ? (
                    <button type="button" onClick={openPrior} className="text-accent hover:underline">
                      {seq.previousName}
                    </button>
                  ) : (
                    seq.previousName
                  )}
                </p>
              )}
              {((seq.arc?.length > 1) || (thread?.courseArc?.length > 1)) && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {(seq.arc || thread.courseArc).map((item) => {
                    const arcLec = resolveLinkLecture(lectures, {
                      path: item.path,
                      id: item.id,
                      priorLecturePath: item.path,
                      priorLectureId: item.id,
                      name: item.name,
                    });
                    const clickable = arcLec && onOpenLecture && !item.active;
                    return clickable ? (
                      <button
                        key={item.path || item.id || item.index}
                        type="button"
                        title={item.name}
                        onClick={() => onOpenLecture(arcLec, { tab: 'overview' })}
                        className="text-[10px] px-1.5 py-0.5 rounded bg-bg-hover text-text-muted hover:bg-accent/20 hover:text-accent"
                      >
                        {item.index}
                      </button>
                    ) : (
                      <span
                        key={item.path || item.id || item.index}
                        title={item.name}
                        className={`text-[10px] px-1.5 py-0.5 rounded ${item.active ? 'bg-accent text-white' : 'bg-bg-hover text-text-muted'}`}
                      >
                        {item.index}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          {studyPath?.units?.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide text-accent font-semibold mb-2">
                {de ? 'Lernpfad' : 'Study path'}
              </p>
              {studyPath.intro && <p className="text-xs text-text-secondary mb-2">{studyPath.intro}</p>}
              <ol className="space-y-2">
                {studyPath.units.map((unit) => (
                  <li key={unit.id} className="rounded-lg bg-bg-tertiary/60 px-3 py-2">
                    <p className="text-sm font-medium text-text-primary">
                      {unit.order}. {unit.label}
                    </p>
                    {onStudyStep && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {unit.steps.map((step) => (
                          <button
                            key={step.id}
                            type="button"
                            onClick={() => onStudyStep(unit, step)}
                            className="text-[10px] px-2 py-1 rounded-md bg-accent/15 text-accent hover:bg-accent/25"
                          >
                            {step.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
              {studyPath.courseLinks?.length > 0 && (
                <ul className="mt-3 text-xs text-text-muted space-y-1">
                  {studyPath.courseLinks.map((link, i) => {
                    const canOpen = !!(link.priorLecturePath || link.priorLectureId) && onOpenLecture;
                    return (
                      <li key={i}>
                        ↗ {link.label}
                        {link.priorLectureName && (
                          <>
                            {' · '}
                            {canOpen ? (
                              <button type="button" onClick={() => openLink(link)} className="text-accent hover:underline">
                                {link.priorLectureName}
                              </button>
                            ) : (
                              link.priorLectureName
                            )}
                          </>
                        )}
                        {link.relation ? <span className="text-text-muted/80"> — {link.relation}</span> : null}
                      </li>
                    );
                  })}
                </ul>
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
