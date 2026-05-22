import React from 'react';

export default function Sidebar({ courses, selectedCourse, onSelectCourse, onOpenHome, showHome, onOpenSettings, showSettings, onOpenControl, showControl, onOpenPlanner, showPlanner, onOpenPdf }) {
  const groups = buildCourseGroups(courses);

  return (
    <div className="w-60 flex-shrink-0 bg-bg-secondary border-r border-border-subtle flex flex-col h-full">
      {/* Titlebar drag region */}
      <div className="h-8 drag-region flex-shrink-0" />

      {/* Logo */}
      <div className="px-5 pb-5 no-drag">
        <div className="flex items-center gap-3">
          <span className="text-2xl">🗂️</span>
          <div>
            <h1 className="text-base font-bold text-text-primary leading-tight">StudyAI</h1>
            <p className="text-text-muted text-xs">Study OS</p>
          </div>
        </div>
      </div>

      {/* Courses label */}
      <div className="px-5 mb-2 no-drag flex items-center justify-between">
        <p className="text-text-muted text-xs font-semibold uppercase tracking-wider">Courses</p>
        <button onClick={onOpenPdf} className="text-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 transition-colors">
          + PDF
        </button>
      </div>

      {/* Course list */}
      <div className="flex-1 overflow-y-auto px-3 no-drag">
        {courses.length === 0 ? (
          <p className="text-text-muted text-xs px-2">No courses yet</p>
        ) : (
          groups.map(group => (
            <div key={group.label} className="mb-3">
              <p className="text-[10px] px-2 pb-1 text-text-muted uppercase tracking-wider">{group.label}</p>
              {group.courses.map(course => (
                <button
                  key={course.id}
                  onClick={() => onSelectCourse(course)}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors mb-1
                    ${selectedCourse?.id === course.id
                      ? 'bg-accent/15 text-text-primary'
                      : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                    }`}
                >
                  <span className="text-lg flex-shrink-0">{course.emoji || '📚'}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate leading-tight">{course.name}</p>
                    <p className="text-text-muted text-[11px] truncate">
                      {course.moduleGroup || 'General'} · {course.credits ? `${course.credits} ECTS` : 'ECTS n/a'}
                    </p>
                  </div>
                  {selectedCourse?.id === course.id && (
                    <div className="ml-auto w-1.5 h-1.5 rounded-full bg-accent flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          ))
        )}
      </div>

      {/* Settings button */}
      <div className="p-3 border-t border-border-subtle no-drag">
        <button
          onClick={onOpenHome}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors mb-1
            ${showHome
              ? 'bg-accent/15 text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
        >
          <span className="text-base">🏠</span>
          <span className="text-sm font-medium">Dashboard</span>
        </button>
        <button
          onClick={onOpenPlanner}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors mb-1
            ${showPlanner
              ? 'bg-accent/15 text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
        >
          <span className="text-base">📅</span>
          <span className="text-sm font-medium">Planner</span>
        </button>
        <button
          onClick={onOpenControl}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors mb-1
            ${showControl
              ? 'bg-accent/15 text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
        >
          <span className="text-base">🧭</span>
          <span className="text-sm font-medium">Study Control</span>
        </button>
        <button
          onClick={onOpenSettings}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-colors
            ${showSettings
              ? 'bg-accent/15 text-text-primary'
              : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
            }`}
        >
          <span className="text-base">⚙️</span>
          <span className="text-sm font-medium">Settings</span>
        </button>
      </div>
    </div>
  );
}

function buildCourseGroups(courses = []) {
  const grouped = {};
  for (const course of courses) {
    const semester = course.semester?.trim() || 'Unscheduled';
    const loadBucket = (course.credits || 0) >= 8 ? 'Heavy load' : (course.credits || 0) >= 5 ? 'Standard load' : 'Light load';
    const label = `${semester} · ${loadBucket}`;
    if (!grouped[label]) grouped[label] = [];
    grouped[label].push(course);
  }
  return Object.entries(grouped).map(([label, groupedCourses]) => ({
    label,
    courses: groupedCourses.sort((a, b) => (b.credits || 0) - (a.credits || 0))
  }));
}
