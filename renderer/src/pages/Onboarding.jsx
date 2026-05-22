import React, { useState } from 'react';

export default function Onboarding({ state, update, refresh }) {
  const [step, setStep] = useState(() => {
    if (!state.apiKey) return 1;
    if (!state.vaultPath) return 2;
    return 3;
  });
  const [apiKey, setApiKey] = useState(state.apiKey || '');
  const [apiKeyVisible, setApiKeyVisible] = useState(false);
  const [courses, setCourses] = useState(state.courses || []);
  const [newCourse, setNewCourse] = useState({ name: '', description: '', emoji: '📚', credits: '', moduleGroup: '', semester: '' });
  const [error, setError] = useState('');

  const steps = [
    { num: 1, label: 'API Key' },
    { num: 2, label: 'Vault Location' },
    { num: 3, label: 'Courses' }
  ];

  // ─── Step 1: API Key ──────────────────────────────────────────────────────
  const handleApiKeySubmit = async () => {
    if (apiKey.trim() && !apiKey.trim().startsWith('sk-')) {
      setError('Please enter a valid OpenAI API key (starts with sk-)');
      return;
    }
    await update('apiKey', apiKey.trim());
    setError('');
    setStep(2);
  };

  // ─── Step 2: Vault Location ───────────────────────────────────────────────
  const handleChooseVault = async () => {
    const folder = await window.api.openFolder();
    if (folder) {
      await update('vaultPath', folder);
      setStep(3);
    }
  };

  // ─── Step 3: Courses ──────────────────────────────────────────────────────
  const addCourse = () => {
    if (!newCourse.name.trim()) return;
    const course = {
      id: Date.now().toString(),
      name: newCourse.name.trim(),
      description: newCourse.description.trim(),
      emoji: newCourse.emoji || '📚',
      color: randomColor(),
      credits: Number(newCourse.credits) || 0,
      moduleGroup: newCourse.moduleGroup.trim(),
      semester: newCourse.semester.trim(),
      priority: 3,
      weeklyHours: 0,
      inFocus: false
    };
    setCourses(prev => [...prev, course]);
    setNewCourse({ name: '', description: '', emoji: '📚', credits: '', moduleGroup: '', semester: '' });
  };

  const removeCourse = (id) => setCourses(prev => prev.filter(c => c.id !== id));

  const finishOnboarding = async () => {
    await update('courses', courses);
    await update('onboardingComplete', true);
    refresh();
  };

  const EMOJIS = ['📚', '🔬', '📐', '💻', '🧠', '📝', '🌍', '⚗️', '📊', '🎨', '🏛️', '🔭'];

  return (
    <div className="h-screen bg-bg-primary flex flex-col items-center justify-center p-8 drag-region">
      {/* Logo */}
      <div className="mb-10 text-center no-drag">
        <div className="text-4xl mb-2">🗂️</div>
        <h1 className="text-2xl font-bold text-text-primary">StudyAI</h1>
        <p className="text-text-secondary text-sm mt-1">Local-first study operating system</p>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-3 mb-8 no-drag">
        {steps.map((s, i) => (
          <React.Fragment key={s.num}>
            <div className={`flex items-center gap-2 ${step === s.num ? 'opacity-100' : step > s.num ? 'opacity-70' : 'opacity-30'}`}>
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                ${step > s.num ? 'bg-green-500 text-white' : step === s.num ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-muted'}`}>
                {step > s.num ? '✓' : s.num}
              </div>
              <span className={`text-sm font-medium ${step === s.num ? 'text-text-primary' : 'text-text-secondary'}`}>
                {s.label}
              </span>
            </div>
            {i < steps.length - 1 && <div className="w-8 h-px bg-border-DEFAULT" />}
          </React.Fragment>
        ))}
      </div>

      {/* Card */}
      <div className="w-full max-w-md bg-bg-secondary border border-border-DEFAULT rounded-2xl p-8 no-drag animate-fade-in">

        {/* Step 1: API Key */}
        {step === 1 && (
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">OpenAI API Key</h2>
            <p className="text-text-secondary text-sm mb-6">
              StudyAI can use OpenAI for summaries, deep dives, quizzes, and Ask AI. Your key is stored locally. You can skip this and add it later.
            </p>
            <div className="relative mb-4">
              <input
                type={apiKeyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApiKeySubmit()}
                placeholder="sk-..."
                className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-xl px-4 py-3 text-text-primary placeholder-text-muted font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                autoFocus
              />
              <button
                onClick={() => setApiKeyVisible(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors text-xs"
              >
                {apiKeyVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            {error && <p className="text-red-400 text-sm mb-4">{error}</p>}
            <a
              href="#"
              onClick={e => { e.preventDefault(); }}
              className="text-accent text-sm hover:text-accent-light mb-6 block"
            >
              Get an API key at platform.openai.com →
            </a>
            <button
              onClick={handleApiKeySubmit}
              className="w-full bg-accent hover:bg-accent-dark text-white font-semibold py-3 rounded-xl transition-colors"
            >
              {apiKey.trim() ? 'Continue →' : 'Continue without AI key →'}
            </button>
          </div>
        )}

        {/* Step 2: Vault Location */}
        {step === 2 && (
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Choose Vault Location</h2>
            <p className="text-text-secondary text-sm mb-6">
              StudyAI will create a local folder structure here for PDFs, generated study artifacts, quiz attempts, and lecture metadata.
            </p>
            <div className="bg-bg-tertiary border border-border-DEFAULT rounded-xl p-4 mb-6 text-center">
              <div className="text-3xl mb-2">📁</div>
              <p className="text-text-secondary text-sm">
                {state.vaultPath || 'No folder selected'}
              </p>
            </div>
            <button
              onClick={handleChooseVault}
              className="w-full bg-accent hover:bg-accent-dark text-white font-semibold py-3 rounded-xl transition-colors"
            >
              Choose Folder →
            </button>
          </div>
        )}

        {/* Step 3: Courses */}
        {step === 3 && (
          <div>
            <h2 className="text-lg font-semibold text-text-primary mb-1">Add Your Courses</h2>
            <p className="text-text-secondary text-sm mb-6">
              Add the courses you're studying. You can always add more later from Settings.
            </p>

            {/* Course list */}
            {courses.length > 0 && (
              <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
                {courses.map(c => (
                  <div key={c.id} className="flex items-center justify-between bg-bg-tertiary rounded-lg px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span>{c.emoji}</span>
                      <div>
                        <p className="text-text-primary text-sm font-medium">{c.name}</p>
                        {c.description && <p className="text-text-muted text-xs">{c.description}</p>}
                      </div>
                    </div>
                    <button
                      onClick={() => removeCourse(c.id)}
                      className="text-text-muted hover:text-red-400 transition-colors text-sm"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add course form */}
            <div className="border border-border-DEFAULT rounded-xl p-4 mb-4">
              <div className="flex gap-2 mb-3">
                <select
                  value={newCourse.emoji}
                  onChange={e => setNewCourse(p => ({ ...p, emoji: e.target.value }))}
                  className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-2 py-2 text-lg focus:outline-none focus:border-accent"
                >
                  {EMOJIS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
                <input
                  type="text"
                  value={newCourse.name}
                  onChange={e => setNewCourse(p => ({ ...p, name: e.target.value }))}
                  onKeyDown={e => e.key === 'Enter' && addCourse()}
                  placeholder="Course name (e.g. Mathematik 1)"
                  className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <input
                type="text"
                value={newCourse.description}
                onChange={e => setNewCourse(p => ({ ...p, description: e.target.value }))}
                placeholder="Short description (e.g. Calculus, first semester)"
                className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent transition-colors mb-3"
              />
              <div className="grid grid-cols-3 gap-2 mb-3">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={newCourse.credits}
                  onChange={e => setNewCourse(p => ({ ...p, credits: e.target.value }))}
                  placeholder="ECTS"
                  className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent transition-colors"
                />
                <input
                  type="text"
                  value={newCourse.moduleGroup}
                  onChange={e => setNewCourse(p => ({ ...p, moduleGroup: e.target.value }))}
                  placeholder="Module group"
                  className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent transition-colors"
                />
                <input
                  type="text"
                  value={newCourse.semester}
                  onChange={e => setNewCourse(p => ({ ...p, semester: e.target.value }))}
                  placeholder="Semester"
                  className="bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-text-primary placeholder-text-muted text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </div>
              <button
                onClick={addCourse}
                disabled={!newCourse.name.trim()}
                className="w-full bg-bg-hover hover:bg-bg-tertiary border border-border-DEFAULT text-text-primary font-medium py-2 rounded-lg transition-colors text-sm disabled:opacity-40"
              >
                + Add Course
              </button>
            </div>

            <button
              onClick={finishOnboarding}
              disabled={courses.length === 0}
              className="w-full bg-accent hover:bg-accent-dark text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {courses.length === 0 ? 'Add at least one course' : `Start using StudyAI →`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function randomColor() {
  const colors = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#10b981', '#3b82f6'];
  return colors[Math.floor(Math.random() * colors.length)];
}
