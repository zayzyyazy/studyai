import React from 'react';
import { getCourseSequence } from '../utils/lectureStructure';

export default function CourseStudyHome({
  course,
  lectures,
  loading,
  isGerman,
  onSelectLecture,
  onStartUnit,
  onOpenCourseLink,
}) {
  const sequenced = [...lectures].sort((a, b) => {
    const ai = getCourseSequence(a)?.index ?? 999;
    const bi = getCourseSequence(b)?.index ?? 999;
    return ai - bi;
  });

  return (
    <div className="flex-1 overflow-y-auto px-5 py-6">
      <div className="max-w-2xl mx-auto space-y-5">
        <div>
          <h2 className="text-lg font-semibold text-text-primary">{course.name}</h2>
          <p className="text-sm text-text-muted mt-1">
            {isGerman
              ? 'Wähle eine Vorlesung. Jede hat einen Lernpfad: Kernthema → Verstehen → Beispiel → Üben.'
              : 'Pick a lecture. Each has a path: core topic → understand → example → practice.'}
          </p>
        </div>

        {loading ? (
          <p className="text-sm text-text-muted text-center py-12">{isGerman ? 'Lade…' : 'Loading…'}</p>
        ) : sequenced.length === 0 ? (
          <p className="text-sm text-text-muted text-center py-12">{isGerman ? 'PDF unten ablegen' : 'Drop a PDF below'}</p>
        ) : (
          <div className="space-y-3">
            {sequenced.map((lec) => {
              const seq = getCourseSequence(lec);
              const path = lec.lectureStructure?.studyPath;
              const firstUnit = path?.units?.[0];
              return (
                <div
                  key={lec.id}
                  className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs text-accent font-semibold tabular-nums">
                        {seq?.label || ''}
                      </p>
                      <p className="text-sm font-semibold text-text-primary truncate">{lec.name}</p>
                      {path?.intro && (
                        <p className="text-xs text-text-muted mt-1 line-clamp-2">{path.intro}</p>
                      )}
                      {firstUnit && (
                        <p className="text-[10px] text-text-secondary mt-2">
                          {isGerman ? 'Start' : 'Start'}: {firstUnit.label}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-col gap-1 flex-shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          if (firstUnit && onStartUnit) {
                            onStartUnit(lec, firstUnit, firstUnit.steps?.[0] || { tab: 'overview' });
                          } else {
                            onSelectLecture(lec);
                          }
                        }}
                        className="text-[10px] px-2.5 py-1.5 rounded-lg bg-accent text-white font-medium"
                      >
                        {isGerman ? 'Starten' : 'Start'}
                      </button>
                      <button
                        type="button"
                        onClick={() => onSelectLecture(lec)}
                        className="text-[10px] px-2.5 py-1.5 rounded-lg border border-border-DEFAULT hover:bg-bg-hover"
                      >
                        {isGerman ? 'Öffnen' : 'Open'}
                      </button>
                    </div>
                  </div>
                  {path?.courseLinks?.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border-subtle space-y-1">
                      {path.courseLinks.slice(0, 2).map((link, i) => {
                        const canOpen = onOpenCourseLink && (link.priorLecturePath || link.priorLectureId);
                        return (
                          <p key={i} className="text-[10px] text-text-muted">
                            ↗ {link.label}
                            {link.priorLectureName && (
                              <>
                                {' · '}
                                {canOpen ? (
                                  <button
                                    type="button"
                                    onClick={() => onOpenCourseLink(link)}
                                    className="text-accent hover:underline"
                                  >
                                    {link.priorLectureName}
                                  </button>
                                ) : (
                                  link.priorLectureName
                                )}
                              </>
                            )}
                          </p>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
