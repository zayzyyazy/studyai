import React, { useState, useEffect, useCallback } from 'react';
import StudyBlockCard from '../components/StudyBlockCard';
import PlannerChat from '../components/PlannerChat';

const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

function getWeekStartLocal() {
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function getTodayDow() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

function isSameWeek(planWeekStart) {
  if (!planWeekStart) return false;
  const planDate = new Date(planWeekStart).toISOString().split('T')[0];
  const thisDate = getWeekStartLocal().toISOString().split('T')[0];
  return planDate === thisDate;
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export default function PlannerPage() {
  const [ctx, setCtx] = useState(null);
  const [plan, setPlan] = useState(null);
  const [weeklyHours, setWeeklyHours] = useState(14);
  const [showChat, setShowChat] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState('');
  const [constraintsInput, setConstraintsInput] = useState('');
  const [showConstraints, setShowConstraints] = useState(false);

  const today = getTodayDow();
  const weekStart = getWeekStartLocal();

  const loadContext = useCallback(async () => {
    const data = await window.api.getPlannerContext();
    setCtx(data);
    if (data.weeklyPlan && isSameWeek(data.weeklyPlan.weekStartDate)) {
      setPlan(data.weeklyPlan);
    }
    if (data.weeklyHoursMax) setWeeklyHours(data.weeklyHoursMax);
  }, []);

  useEffect(() => {
    loadContext();
  }, [loadContext]);

  async function handleGenerate() {
    setGenerating(true);
    setGenError('');
    const result = await window.api.generatePlan({
      weeklyHours,
      constraints: constraintsInput.trim()
    });
    setGenerating(false);
    if (result.success) {
      setPlan(result.plan);
      setShowConstraints(false);
      setConstraintsInput('');
    } else {
      setGenError(result.error || 'Failed to generate plan');
    }
  }

  async function handleBlockUpdate(blockId, changes) {
    const result = await window.api.updatePlanBlock({ blockId, changes });
    if (result.success) setPlan(result.plan);
  }

  async function handleClearPlan() {
    await window.api.clearPlan();
    setPlan(null);
  }

  function onPlanUpdate(newPlan) {
    setPlan(newPlan);
  }

  // Compute stats
  const blocks = plan?.blocks || [];
  const totalPlannedMin = blocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const doneMin = blocks.filter(b => b.status === 'done').reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const budgetMin = weeklyHours * 60;
  const plannedPct = Math.min(100, Math.round((totalPlannedMin / budgetMin) * 100));
  const donePct = Math.min(100, Math.round((doneMin / budgetMin) * 100));
  const remainingMin = budgetMin - doneMin;

  const todayBlocks = blocks.filter(b => b.dayOfWeek === today);
  const pendingToday = todayBlocks.filter(b => b.status === 'pending');
  const doneToday = todayBlocks.filter(b => b.status === 'done');
  const skippedToday = todayBlocks.filter(b => b.status === 'skipped');

  const planIsStale = plan && !isSameWeek(plan.weekStartDate);

  return (
    <div className="h-full flex bg-bg-primary overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="h-8 drag-region flex-shrink-0" />

        <div className="flex-1 overflow-y-auto no-drag px-6 pb-8">
          <div className="max-w-3xl mx-auto">

            {/* ── Header ── */}
            <div className="flex items-start justify-between mb-4">
              <div>
                <h1 className="text-xl font-bold text-text-primary">Weekly Planner</h1>
                <p className="text-sm text-text-muted">
                  Week of {weekStart.toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                  {' · '}{weeklyHours}h budget
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => setShowChat(v => !v)}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                    showChat
                      ? 'bg-accent text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover'
                  }`}
                >
                  🤖 AI Chat
                </button>
                <button
                  onClick={() => setShowConstraints(v => !v)}
                  className="px-3 py-2 rounded-lg bg-bg-tertiary text-text-secondary hover:text-text-primary text-sm font-medium transition-colors"
                  title="Set weekly constraints before generating"
                >
                  ⚙
                </button>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="px-3 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50 hover:bg-accent/90 transition-colors"
                >
                  {generating ? 'Generating…' : plan ? '↺ Regenerate' : '✦ Generate Plan'}
                </button>
              </div>
            </div>

            {/* ── Constraints input ── */}
            {showConstraints && (
              <div className="mb-4 rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
                <p className="text-sm font-medium text-text-primary mb-2">Constraints for this week</p>
                <p className="text-xs text-text-muted mb-2">Tell the planner about anything special this week (e.g., "quiz next Thursday in Statistics", "only 10 hours available", "focus on Finance").</p>
                <textarea
                  value={constraintsInput}
                  onChange={e => setConstraintsInput(e.target.value)}
                  placeholder="e.g. I have a quiz in Statistics on Thursday. Skip the heavy math days."
                  rows={2}
                  className="w-full bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent"
                />
              </div>
            )}

            {/* ── Errors ── */}
            {genError && (
              <div className="mb-4 p-3 rounded-xl border border-red-500/30 bg-red-500/10 text-red-400 text-sm">
                {genError}
              </div>
            )}

            {/* ── Stale plan warning ── */}
            {planIsStale && (
              <div className="mb-4 p-3 rounded-xl border border-yellow-500/30 bg-yellow-500/10 text-yellow-400 text-sm flex items-center justify-between gap-3">
                <span>This plan is from a previous week. Generate a new one for this week.</span>
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="flex-shrink-0 px-3 py-1 rounded-lg bg-yellow-500/20 text-yellow-400 text-xs font-semibold hover:bg-yellow-500/30 transition-colors"
                >
                  Regenerate
                </button>
              </div>
            )}

            {/* ── Hours budget bar ── */}
            {plan && !planIsStale && (
              <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-5">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-semibold text-text-primary">Weekly Budget</span>
                  <div className="flex items-center gap-3 text-xs text-text-muted">
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-accent inline-block" />
                      {fmtHours(totalPlannedMin)} planned
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2 h-2 rounded-full bg-green-400 inline-block" />
                      {fmtHours(doneMin)} done
                    </span>
                    <span>{weeklyHours}h total</span>
                  </div>
                </div>
                {/* Planned bar */}
                <div className="h-2 bg-bg-hover rounded-full overflow-hidden mb-1">
                  <div
                    className={`h-full rounded-full transition-all ${plannedPct > 95 ? 'bg-red-400' : 'bg-accent/60'}`}
                    style={{ width: `${plannedPct}%` }}
                  />
                </div>
                {/* Done bar */}
                <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-green-400 transition-all"
                    style={{ width: `${donePct}%` }}
                  />
                </div>
                {plan.summary && (
                  <p className="text-xs text-text-muted mt-2.5 leading-relaxed">{plan.summary}</p>
                )}
              </div>
            )}

            {/* ── Today's focus ── */}
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-text-primary">
                  Today — {DAY_NAMES[today]}, {new Date().toLocaleDateString('en', { month: 'short', day: 'numeric' })}
                </h2>
                {todayBlocks.length > 0 && (
                  <span className="text-xs text-text-muted">
                    {fmtHours(todayBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0))} total
                    {doneToday.length > 0 && ` · ${doneToday.length} done`}
                  </span>
                )}
              </div>

              {!plan || planIsStale ? (
                <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-6 text-center">
                  <div className="text-3xl mb-2">📅</div>
                  <p className="text-text-muted text-sm mb-1">No plan for this week yet.</p>
                  <p className="text-text-muted text-xs mb-4">The AI planner uses your courses and lectures to build a realistic, effort-aware study schedule.</p>
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold disabled:opacity-50"
                  >
                    {generating ? 'Generating…' : '✦ Generate My Weekly Plan'}
                  </button>
                </div>
              ) : todayBlocks.length === 0 ? (
                <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 text-sm text-text-muted text-center">
                  No blocks scheduled for today. Enjoy the break — or ask the AI planner to add something.
                </div>
              ) : (
                <div className="space-y-2">
                  {pendingToday.map(block => (
                    <StudyBlockCard key={block.id} block={block} isToday onUpdate={handleBlockUpdate} />
                  ))}
                  {doneToday.map(block => (
                    <StudyBlockCard key={block.id} block={block} isToday onUpdate={handleBlockUpdate} />
                  ))}
                  {skippedToday.map(block => (
                    <StudyBlockCard key={block.id} block={block} isToday onUpdate={handleBlockUpdate} />
                  ))}
                </div>
              )}
            </div>

            {/* ── Rest of the week ── */}
            {plan && !planIsStale && (
              <div className="mb-5">
                <h2 className="text-sm font-bold text-text-primary mb-3">Rest of the Week</h2>
                {DAY_NAMES.map((dayName, dayIdx) => {
                  if (dayIdx === today) return null;
                  const dayBlocks = blocks.filter(b => b.dayOfWeek === dayIdx);
                  if (!dayBlocks.length) return null;
                  const dayMin = dayBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
                  const doneDayCount = dayBlocks.filter(b => b.status === 'done').length;
                  return (
                    <div key={dayIdx} className="mb-4">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="text-xs font-semibold text-text-muted uppercase tracking-wider">{DAY_SHORT[dayIdx]}</p>
                        <span className="text-xs text-text-muted">{fmtHours(dayMin)}</span>
                        {doneDayCount === dayBlocks.length && dayBlocks.length > 0 && (
                          <span className="text-[10px] text-green-400 font-semibold">All done</span>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        {dayBlocks.map(block => (
                          <StudyBlockCard key={block.id} block={block} isToday={false} onUpdate={handleBlockUpdate} />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* ── Per-course summary ── */}
            {plan && !planIsStale && plan.hoursPerCourse && Object.keys(plan.hoursPerCourse).length > 0 && (
              <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4">
                <h2 className="text-sm font-semibold text-text-primary mb-3">Hours per Course</h2>
                <div className="space-y-2">
                  {Object.entries(plan.hoursPerCourse).map(([courseId, hours]) => {
                    const course = ctx?.courses?.find(c => c.id === courseId);
                    const courseName = course?.name || courseId;
                    const courseEmoji = course?.emoji || '📚';
                    const courseBlocks = blocks.filter(b => b.courseId === courseId);
                    const courseMin = courseBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
                    const courseDoneMin = courseBlocks.filter(b => b.status === 'done').reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
                    return (
                      <div key={courseId} className="flex items-center gap-3">
                        <span className="text-base flex-shrink-0">{courseEmoji}</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-0.5">
                            <p className="text-xs text-text-secondary font-medium truncate">{courseName}</p>
                            <span className="text-xs text-text-muted flex-shrink-0 ml-2">
                              {fmtHours(courseDoneMin)} / {fmtHours(courseMin)}
                            </span>
                          </div>
                          <div className="h-1 bg-bg-hover rounded-full overflow-hidden">
                            <div
                              className="h-full bg-accent/60 rounded-full"
                              style={{ width: courseMin > 0 ? `${Math.min(100, Math.round(courseDoneMin / courseMin * 100))}%` : '0%' }}
                            />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* ── Generating spinner ── */}
            {generating && (
              <div className="text-center py-10">
                <div className="inline-block w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin mb-3" />
                <p className="text-text-muted text-sm">Analyzing your lectures and building a realistic plan…</p>
                <p className="text-text-muted text-xs mt-1">This usually takes 10-20 seconds</p>
              </div>
            )}

            {/* ── Clear plan ── */}
            {plan && !generating && (
              <div className="text-center mt-2">
                <button
                  onClick={handleClearPlan}
                  className="text-xs text-text-muted hover:text-red-400 transition-colors"
                >
                  Clear this plan
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── Chat panel ── */}
      {showChat && (
        <PlannerChat
          weeklyHours={weeklyHours}
          onPlanUpdate={onPlanUpdate}
          onClose={() => setShowChat(false)}
        />
      )}
    </div>
  );
}
