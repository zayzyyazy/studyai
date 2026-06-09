import React, { useState } from 'react';

const DEFAULT_PLUGIN_SETTINGS = {
  pdfIntake: true,
  courseAwareGeneration: true,
  mathStatsSupport: true,
  localExporters: true,
  studyPlanner: true
};

export default function SettingsPanel({ state, update, refresh, onClose }) {
  const [apiKey, setApiKey] = useState(state.apiKey || '');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [model, setModel] = useState(state.generationModel || 'gpt-4o');
  const [languagePreference, setLanguagePreference] = useState(state.outputLanguagePreference || 'auto');
  const [generationMode, setGenerationMode] = useState(state.generationMode || 'balanced');
  const [pluginSettings, setPluginSettings] = useState({ ...DEFAULT_PLUGIN_SETTINGS, ...(state.pluginSettings || {}) });
  const [schedulerDefaults, setSchedulerDefaults] = useState(state.schedulerDefaults || {
    weeklyReviewDay: 'Sunday',
    revisitAfterDays: 7,
    targetHoursPerEcts: 0.75
  });
  const [weeklyHoursMax, setWeeklyHoursMax] = useState(state.weeklyHoursMax || 14);
  const [weeklyHoursSaved, setWeeklyHoursSaved] = useState(false);
  const [courses, setCourses] = useState(state.courses || []);
  const [editingCourse, setEditingCourse] = useState(null);
  const [newCourse, setNewCourse] = useState({ name: '', description: '', emoji: '📚', credits: '', moduleGroup: '', semester: '', language: 'auto', courseType: 'auto' });
  const [showAddForm, setShowAddForm] = useState(false);

  const EMOJIS = ['📚', '🔬', '📐', '💻', '🧠', '📝', '🌍', '⚗️', '📊', '🎨', '🏛️', '🔭'];

  const saveApiKey = async () => {
    await update('apiKey', apiKey.trim());
    setApiKeySaved(true);
    setTimeout(() => setApiKeySaved(false), 2000);
  };

  const saveGenerationSettings = async () => {
    await update('generationModel', model);
    await update('outputLanguagePreference', languagePreference);
    await update('generationMode', generationMode);
    refresh();
  };

  const saveSchedulerDefaults = async (next) => {
    setSchedulerDefaults(next);
    await update('schedulerDefaults', next);
  };

  const saveWeeklyHours = async () => {
    const v = Math.max(1, Math.min(40, Number(weeklyHoursMax) || 14));
    setWeeklyHoursMax(v);
    await update('weeklyHoursMax', v);
    setWeeklyHoursSaved(true);
    setTimeout(() => setWeeklyHoursSaved(false), 2000);
  };

  const togglePlugin = async (key) => {
    const next = { ...DEFAULT_PLUGIN_SETTINGS, ...pluginSettings, [key]: !pluginSettings[key] };
    setPluginSettings(next);
    await update('pluginSettings', next);
  };

  const changeVault = async () => {
    const folder = await window.api.openFolder();
    if (folder) await update('vaultPath', folder);
  };

  const saveCourses = async (newCourses) => {
    setCourses(newCourses);
    await update('courses', newCourses);
    refresh();
  };

  const addCourse = async () => {
    if (!newCourse.name.trim()) return;
    const course = {
      id: Date.now().toString(),
      name: newCourse.name.trim(),
      description: newCourse.description.trim(),
      emoji: newCourse.emoji || '📚',
      color: '#6366f1',
      credits: Number(newCourse.credits) || 0,
      moduleGroup: newCourse.moduleGroup.trim(),
      semester: newCourse.semester.trim(),
      priority: 3,
      weeklyHours: 0,
      inFocus: false,
      language: newCourse.language,
      courseType: newCourse.courseType
    };
    await saveCourses([...courses, course]);
    setNewCourse({ name: '', description: '', emoji: '📚', credits: '', moduleGroup: '', semester: '', language: 'auto', courseType: 'auto' });
    setShowAddForm(false);
  };

  const deleteCourse = async (id) => {
    if (!confirm('Delete this course? (Vault files are not deleted)')) return;
    await saveCourses(courses.filter(c => c.id !== id));
  };

  const saveEditCourse = async () => {
    if (!editingCourse.name.trim()) return;
    await saveCourses(courses.map(c => c.id === editingCourse.id ? editingCourse : c));
    setEditingCourse(null);
  };

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      <div className="h-8 drag-region flex-shrink-0" />

      <div className="flex-1 overflow-y-auto no-drag">
        <div className="max-w-2xl mx-auto px-8 pb-8">
          {/* Header */}
          <div className="flex items-center justify-between mb-8">
            <h1 className="text-xl font-bold text-text-primary">Settings</h1>
          </div>

          {/* API Key */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-1">AI Provider</h2>
            <p className="text-text-muted text-sm mb-4">Stored locally. StudyAI remains usable without a key; generation actions will ask you to add one.</p>
            <div className="flex gap-3">
              <div className="relative flex-1">
                <input
                  type={apiKeyVisible ? 'text' : 'password'}
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                  className="w-full bg-bg-secondary border border-border-DEFAULT rounded-xl px-4 py-3 text-text-primary font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                />
                <button
                  onClick={() => setApiKeyVisible(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary text-xs"
                >
                  {apiKeyVisible ? 'Hide' : 'Show'}
                </button>
              </div>
              <button
                onClick={saveApiKey}
                className={`px-5 py-3 rounded-xl font-semibold text-sm transition-colors
                  ${apiKeySaved ? 'bg-green-500 text-white' : 'bg-accent hover:bg-accent-dark text-white'}`}
              >
                {apiKeySaved ? '✓ Saved' : 'Save'}
              </button>
            </div>
          </section>

          {/* Generation Preferences */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-1">Generation Preferences</h2>
            <p className="text-text-muted text-sm mb-4">Controls the local backend pipeline for summaries, deep dives, quizzes, and Ask AI.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
              <label className="text-xs text-text-muted">
                Model
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                >
                  <option value="gpt-4o">gpt-4o</option>
                  <option value="gpt-4o-mini">gpt-4o-mini</option>
                  <option value="gpt-4.1">gpt-4.1</option>
                  <option value="gpt-4.1-mini">gpt-4.1-mini</option>
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Output language
                <select
                  value={languagePreference}
                  onChange={(e) => setLanguagePreference(e.target.value)}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                >
                  <option value="auto">Infer from lecture/course</option>
                  <option value="German">German</option>
                  <option value="English">English</option>
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Style
                <select
                  value={generationMode}
                  onChange={(e) => setGenerationMode(e.target.value)}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                >
                  <option value="precise">Precise</option>
                  <option value="balanced">Balanced</option>
                  <option value="exploratory">Exploratory</option>
                </select>
              </label>
            </div>
            <button onClick={saveGenerationSettings} className="px-4 py-2 rounded-xl border border-border-DEFAULT text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-sm font-medium">
              Save Generation Settings
            </button>
          </section>

          {/* Vault Path */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-1">Vault Location</h2>
            <p className="text-text-muted text-sm mb-4">Where your lecture notes and PDFs are stored</p>
            <div className="flex gap-3 items-center">
              <div className="flex-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-4 py-3">
                <p className="text-text-secondary text-sm font-mono truncate">
                  {state.vaultPath || 'No vault path set'}
                </p>
              </div>
              <button
                onClick={changeVault}
                className="px-4 py-3 rounded-xl border border-border-DEFAULT text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-sm font-medium flex-shrink-0"
              >
                Change
              </button>
              <button
                onClick={() => state.vaultPath && window.api.openPath(state.vaultPath)}
                disabled={!state.vaultPath}
                className="px-4 py-3 rounded-xl border border-border-DEFAULT text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors text-sm font-medium flex-shrink-0 disabled:opacity-40"
              >
                Open in Finder
              </button>
            </div>
          </section>

          {/* Study Planning Defaults */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-1">Study Planning</h2>
            <p className="text-text-muted text-sm mb-4">Controls your weekly planner and workload budget.</p>

            {/* Weekly hours budget */}
            <div className="bg-bg-secondary border border-border-DEFAULT rounded-xl px-4 py-4 mb-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <p className="text-sm font-medium text-text-primary">Weekly study hours</p>
                  <p className="text-xs text-text-muted mt-0.5">Maximum hours the AI planner can schedule per week</p>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <input
                    type="number"
                    min="1"
                    max="40"
                    value={weeklyHoursMax}
                    onChange={e => setWeeklyHoursMax(e.target.value)}
                    className="w-20 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm text-center focus:outline-none focus:border-accent"
                  />
                  <span className="text-sm text-text-muted">h/week</span>
                  <button
                    onClick={saveWeeklyHours}
                    className={`px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                      weeklyHoursSaved ? 'bg-green-500/20 text-green-400' : 'bg-accent/15 text-accent hover:bg-accent/25'
                    }`}
                  >
                    {weeklyHoursSaved ? 'Saved!' : 'Save'}
                  </button>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <label className="text-xs text-text-muted">
                Review day
                <select
                  value={schedulerDefaults.weeklyReviewDay || 'Sunday'}
                  onChange={(e) => saveSchedulerDefaults({ ...schedulerDefaults, weeklyReviewDay: e.target.value })}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                >
                  {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map(day => <option key={day} value={day}>{day}</option>)}
                </select>
              </label>
              <label className="text-xs text-text-muted">
                Revisit after days
                <input
                  type="number"
                  min="1"
                  max="30"
                  value={schedulerDefaults.revisitAfterDays || 7}
                  onChange={(e) => saveSchedulerDefaults({ ...schedulerDefaults, revisitAfterDays: Number(e.target.value) || 7 })}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                />
              </label>
              <label className="text-xs text-text-muted">
                Hours per ECTS
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.25"
                  value={schedulerDefaults.targetHoursPerEcts || 0.75}
                  onChange={(e) => saveSchedulerDefaults({ ...schedulerDefaults, targetHoursPerEcts: Number(e.target.value) || 0.75 })}
                  className="w-full mt-1 bg-bg-secondary border border-border-DEFAULT rounded-xl px-3 py-2 text-text-primary text-sm"
                />
              </label>
            </div>
          </section>

          {/* Extension Modules */}
          <section className="mb-8">
            <h2 className="text-base font-semibold text-text-primary mb-1">Extension Modules</h2>
            <p className="text-text-muted text-sm mb-4">Internal modules now; shaped so ingestion, generation, exporters, and planning can become plugins later.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                ['pdfIntake', 'PDF intake'],
                ['courseAwareGeneration', 'Course-aware generation'],
                ['mathStatsSupport', 'Math/statistics support'],
                ['localExporters', 'Local exporters'],
                ['studyPlanner', 'Study planner']
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 bg-bg-secondary border border-border-DEFAULT rounded-xl px-4 py-3 text-sm text-text-secondary">
                  <span>{label}</span>
                  <input type="checkbox" checked={pluginSettings[key] !== false} onChange={() => togglePlugin(key)} />
                </label>
              ))}
            </div>
          </section>

          {/* Courses */}
          <section>
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-base font-semibold text-text-primary">Courses</h2>
                <p className="text-text-muted text-sm">Manage your course list</p>
              </div>
              <button
                onClick={() => setShowAddForm(v => !v)}
                className="px-4 py-2 rounded-xl bg-accent hover:bg-accent-dark text-white font-semibold text-sm transition-colors"
              >
                + Add Course
              </button>
            </div>

            {/* Add course form */}
            {showAddForm && (
              <div className="bg-bg-secondary border border-accent/30 rounded-xl p-4 mb-4 animate-fade-in">
                <div className="flex gap-2 mb-3">
                  <select
                    value={newCourse.emoji}
                    onChange={e => setNewCourse(p => ({ ...p, emoji: e.target.value }))}
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-2 py-2 text-lg focus:outline-none"
                  >
                    {EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
                  </select>
                  <input
                    type="text"
                    value={newCourse.name}
                    onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))}
                    placeholder="Course name"
                    className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <input
                  type="text"
                  value={newCourse.description}
                  onChange={e => setNewCourse(p => ({ ...p, description: e.target.value }))}
                  placeholder="Short description"
                  className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent mb-3"
                />
                <div className="grid grid-cols-3 gap-2 mb-3">
                  <input
                    type="number"
                    min="0"
                    step="0.5"
                    value={newCourse.credits}
                    onChange={e => setNewCourse(p => ({ ...p, credits: e.target.value }))}
                    placeholder="ECTS"
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    value={newCourse.moduleGroup}
                    onChange={e => setNewCourse(p => ({ ...p, moduleGroup: e.target.value }))}
                    placeholder="Module group"
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  />
                  <input
                    type="text"
                    value={newCourse.semester}
                    onChange={e => setNewCourse(p => ({ ...p, semester: e.target.value }))}
                    placeholder="Semester"
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <select
                    value={newCourse.language}
                    onChange={e => setNewCourse(p => ({ ...p, language: e.target.value }))}
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="auto">Language: auto</option>
                    <option value="German">German</option>
                    <option value="English">English</option>
                  </select>
                  <select
                    value={newCourse.courseType}
                    onChange={e => setNewCourse(p => ({ ...p, courseType: e.target.value }))}
                    className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary text-sm focus:outline-none focus:border-accent"
                  >
                    <option value="auto">Type: auto</option>
                    <option value="math">Mathematics</option>
                    <option value="statistics">Statistics</option>
                    <option value="programming">Programming</option>
                    <option value="psychology">Psychology</option>
                    <option value="conceptual">Conceptual</option>
                    <option value="reading">Reading-heavy</option>
                  </select>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => { setShowAddForm(false); setNewCourse({ name: '', description: '', emoji: '📚', credits: '', moduleGroup: '', semester: '', language: 'auto', courseType: 'auto' }); }}
                    className="flex-1 py-2 rounded-lg border border-border-DEFAULT text-text-secondary text-sm hover:bg-bg-hover transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={addCourse}
                    disabled={!newCourse.name.trim()}
                    className="flex-1 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white text-sm font-semibold transition-colors disabled:opacity-40"
                  >
                    Add Course
                  </button>
                </div>
              </div>
            )}

            {/* Course list */}
            <div className="space-y-2">
              {courses.map(course => (
                <div key={course.id} className="bg-bg-secondary border border-border-DEFAULT rounded-xl p-4">
                  {editingCourse?.id === course.id ? (
                    <div>
                      <div className="flex gap-2 mb-3">
                        <select
                          value={editingCourse.emoji}
                          onChange={e => setEditingCourse(p => ({ ...p, emoji: e.target.value }))}
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-2 py-1.5 text-base focus:outline-none"
                        >
                          {EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
                        </select>
                        <input
                          type="text"
                          value={editingCourse.name}
                          onChange={e => setEditingCourse(p => ({ ...p, name: e.target.value }))}
                          className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                      <input
                        type="text"
                        value={editingCourse.description}
                        onChange={e => setEditingCourse(p => ({ ...p, description: e.target.value }))}
                        className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent mb-3"
                      />
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={editingCourse.credits || ''}
                          onChange={e => setEditingCourse(p => ({ ...p, credits: Number(e.target.value) || 0 }))}
                          placeholder="ECTS"
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        />
                        <input
                          type="text"
                          value={editingCourse.moduleGroup || ''}
                          onChange={e => setEditingCourse(p => ({ ...p, moduleGroup: e.target.value }))}
                          placeholder="Module group"
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        />
                        <input
                          type="text"
                          value={editingCourse.semester || ''}
                          onChange={e => setEditingCourse(p => ({ ...p, semester: e.target.value }))}
                          placeholder="Semester"
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-3">
                        <select
                          value={editingCourse.language || 'auto'}
                          onChange={e => setEditingCourse(p => ({ ...p, language: e.target.value }))}
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        >
                          <option value="auto">Language: auto</option>
                          <option value="German">German</option>
                          <option value="English">English</option>
                        </select>
                        <select
                          value={editingCourse.courseType || 'auto'}
                          onChange={e => setEditingCourse(p => ({ ...p, courseType: e.target.value }))}
                          className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-1.5 text-text-primary text-sm focus:outline-none focus:border-accent"
                        >
                          <option value="auto">Type: auto</option>
                          <option value="math">Mathematics</option>
                          <option value="statistics">Statistics</option>
                          <option value="programming">Programming</option>
                          <option value="psychology">Psychology</option>
                          <option value="conceptual">Conceptual</option>
                          <option value="reading">Reading-heavy</option>
                        </select>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => setEditingCourse(null)}
                          className="flex-1 py-1.5 rounded-lg border border-border-DEFAULT text-text-secondary text-xs hover:bg-bg-hover transition-colors">
                          Cancel
                        </button>
                        <button onClick={saveEditCourse}
                          className="flex-1 py-1.5 rounded-lg bg-accent hover:bg-accent-dark text-white text-xs font-semibold transition-colors">
                          Save
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-3">
                      <span className="text-xl">{course.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-text-primary text-sm font-medium">{course.name}</p>
                        <p className="text-text-muted text-xs truncate">
                          {course.description || 'No description'} · {course.credits || 0} ECTS · {course.moduleGroup || 'General'} · {course.semester || 'Unscheduled'} · {course.language || 'auto'}
                        </p>
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setEditingCourse({ ...course })}
                          className="text-text-muted hover:text-text-primary text-xs px-2 py-1 rounded hover:bg-bg-hover transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => deleteCourse(course.id)}
                          className="text-text-muted hover:text-red-400 text-xs px-2 py-1 rounded hover:bg-bg-hover transition-colors"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
