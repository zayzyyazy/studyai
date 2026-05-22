import React, { useEffect, useMemo, useState } from 'react';

export default function StudyControlPage({ state, update }) {
  const [overview, setOverview] = useState([]);

  useEffect(() => {
    window.api.getCourseOverview().then((rows) => setOverview(rows || []));
  }, [state.courses]);

  const courseRows = useMemo(() => {
    return (state.courses || []).map((course) => {
      const stats = overview.find((row) => row.courseId === course.id) || {};
      const priority = Number(course.priority || 3);
      const weeklyHours = Number(course.weeklyHours || 0);
      const inFocus = Boolean(course.inFocus);
      const loadScore = (Number(course.credits) || 0) * priority;
      return { course, stats, priority, weeklyHours, inFocus, loadScore };
    }).sort((a, b) => Number(b.inFocus) - Number(a.inFocus) || b.loadScore - a.loadScore);
  }, [state.courses, overview]);

  const totalWeeklyHours = courseRows.reduce((acc, row) => acc + row.weeklyHours, 0);

  const persistCourse = async (courseId, patch) => {
    const updated = (state.courses || []).map((c) => c.id === courseId ? { ...c, ...patch } : c);
    await update('courses', updated);
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      <div className="h-8 drag-region flex-shrink-0" />
      <div className="flex-1 overflow-y-auto no-drag">
        <div className="max-w-4xl mx-auto px-8 pb-8">
          <div className="mb-6">
            <h1 className="text-xl font-bold text-text-primary">Study Control</h1>
            <p className="text-sm text-text-muted mt-1">Set focus, priority, and weekly load without turning this into project management.</p>
          </div>

          <div className="mb-5 rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
            <p className="text-sm text-text-secondary">Planned weekly effort: <span className="text-text-primary font-semibold">{totalWeeklyHours}h</span></p>
          </div>

          <div className="space-y-3">
            {courseRows.map(({ course, stats, priority, weeklyHours, inFocus }) => (
              <div key={course.id} className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
                <div className="flex items-start gap-3">
                  <span className="text-xl">{course.emoji || '📚'}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-text-primary font-medium">{course.name}</p>
                    <p className="text-xs text-text-muted">
                      {(course.moduleGroup || 'General')} · {(course.credits || 0)} ECTS · {(course.semester || 'Unscheduled')}
                    </p>
                    <p className="text-xs text-text-muted mt-1">
                      Lectures: {stats.lectureCount || 0} · Started: {stats.startedCount || 0} · Active: {stats.activeCount || 0}
                    </p>
                  </div>
                  <label className="text-xs text-text-secondary flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={inFocus}
                      onChange={(e) => persistCourse(course.id, { inFocus: e.target.checked })}
                    />
                    Focus now
                  </label>
                </div>
                <div className="grid grid-cols-2 gap-3 mt-3">
                  <label className="text-xs text-text-muted">
                    Priority
                    <input
                      type="range"
                      min="1"
                      max="5"
                      value={priority}
                      onChange={(e) => persistCourse(course.id, { priority: Number(e.target.value) })}
                      className="w-full mt-1"
                    />
                    <span className="text-text-secondary">{priority}/5</span>
                  </label>
                  <label className="text-xs text-text-muted">
                    Weekly hours
                    <input
                      type="number"
                      min="0"
                      max="20"
                      value={weeklyHours}
                      onChange={(e) => persistCourse(course.id, { weeklyHours: Number(e.target.value) || 0 })}
                      className="w-full mt-1 bg-bg-tertiary border border-border-DEFAULT rounded px-2 py-1 text-text-primary"
                    />
                  </label>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
