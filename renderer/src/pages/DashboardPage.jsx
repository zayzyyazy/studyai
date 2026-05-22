import React, { useEffect, useState } from 'react';
import StudyBlockCard from '../components/StudyBlockCard';

function getTodayDow() {
  const d = new Date().getDay();
  return d === 0 ? 6 : d - 1;
}

function isSameWeek(planWeekStart) {
  if (!planWeekStart) return false;
  const planDate = new Date(planWeekStart).toISOString().split('T')[0];
  const now = new Date();
  const day = now.getDay();
  const monday = new Date(now);
  monday.setDate(now.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);
  return planDate === monday.toISOString().split('T')[0];
}

function fmtHours(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

function profileLabel(profile) {
  if (profile === 'math_stats') return 'Math/Stats';
  if (profile === 'applied_methods') return 'Methods';
  if (profile === 'reading_heavy') return 'Reading';
  return 'Study';
}

export default function DashboardPage({ onOpenPdf, onOpenPlanner }) {
  const [data, setData] = useState(null);
  const [planCtx, setPlanCtx] = useState(null);
  const [todayBlocks, setTodayBlocks] = useState([]);

  const today = getTodayDow();

  useEffect(() => {
    window.api.getDashboard().then(setData);
    window.api.getPlannerContext().then(ctx => {
      setPlanCtx(ctx);
      if (ctx.weeklyPlan && isSameWeek(ctx.weeklyPlan.weekStartDate)) {
        const dow = getTodayDow();
        const blocks = ctx.weeklyPlan.blocks?.filter(b => b.dayOfWeek === dow) || [];
        setTodayBlocks(blocks);
      }
    });
  }, []);

  async function handleBlockUpdate(blockId, changes) {
    const result = await window.api.updatePlanBlock({ blockId, changes });
    if (result.success && result.plan) {
      const dow = getTodayDow();
      setTodayBlocks(result.plan.blocks?.filter(b => b.dayOfWeek === dow) || []);
    }
  }

  if (!data) {
    return <div className="h-full flex items-center justify-center text-text-muted">Loading…</div>;
  }

  const plan = planCtx?.weeklyPlan && isSameWeek(planCtx?.weeklyPlan?.weekStartDate) ? planCtx.weeklyPlan : null;
  const weeklyHoursMax = planCtx?.weeklyHoursMax || 14;
  const budgetMin = weeklyHoursMax * 60;
  const allBlocks = plan?.blocks || [];
  const doneMin = allBlocks.filter(b => b.status === 'done').reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const plannedMin = allBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const donePct = budgetMin > 0 ? Math.min(100, Math.round(doneMin / budgetMin * 100)) : 0;
  const plannedPct = budgetMin > 0 ? Math.min(100, Math.round(plannedMin / budgetMin * 100)) : 0;

  const pendingToday = todayBlocks.filter(b => b.status === 'pending');
  const doneToday = todayBlocks.filter(b => b.status === 'done');

  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayName = DAY_NAMES[today];

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      <div className="h-8 drag-region flex-shrink-0" />
      <div className="flex-1 overflow-y-auto no-drag px-6 pb-8">
        <div className="max-w-5xl mx-auto">

          {/* ── Header ── */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold text-text-primary">Dashboard</h1>
              <p className="text-sm text-text-muted">
                {todayName}, {new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <button onClick={onOpenPdf} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors">
              + Add PDFs
            </button>
          </div>

          {/* ── Metric cards ── */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <MetricCard label="Total lectures" value={data.totalLectures} />
            <MetricCard label="Started" value={data.startedLectures} />
            <MetricCard label="Course load" value={`${data.totalCredits || 0} ECTS`} />
          </div>

          {/* ── Weekly budget (if plan exists) ── */}
          {plan ? (
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">This Week's Budget</h2>
                  <p className="text-xs text-text-muted">{weeklyHoursMax}h total · {allBlocks.length} blocks planned</p>
                </div>
                <button
                  onClick={onOpenPlanner}
                  className="text-xs px-3 py-1.5 rounded-lg bg-accent/15 text-accent hover:bg-accent/25 transition-colors font-medium"
                >
                  Open Planner →
                </button>
              </div>
              <div className="space-y-1">
                <div className="h-2 bg-bg-hover rounded-full overflow-hidden">
                  <div className="h-full bg-accent/50 rounded-full" style={{ width: `${plannedPct}%` }} />
                </div>
                <div className="h-1.5 bg-bg-hover rounded-full overflow-hidden">
                  <div className="h-full bg-green-400 rounded-full" style={{ width: `${donePct}%` }} />
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-xs text-text-muted">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-accent/50" />
                  {fmtHours(plannedMin)} planned
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  {fmtHours(doneMin)} done
                </span>
                <span>{fmtHours(Math.max(0, budgetMin - doneMin))} remaining</span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4 flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-text-primary mb-0.5">No weekly plan yet</h2>
                <p className="text-xs text-text-muted">Generate an AI plan to see your weekly study schedule here.</p>
              </div>
              <button
                onClick={onOpenPlanner}
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors"
              >
                Go to Planner
              </button>
            </div>
          )}

          {/* ── Today's blocks ── */}
          {todayBlocks.length > 0 && (
            <div className="mb-5">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-text-primary">Study Today — {todayName}</h2>
                <span className="text-xs text-text-muted">
                  {fmtHours(todayBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0))}
                  {doneToday.length > 0 && ` · ${doneToday.length}/${todayBlocks.length} done`}
                </span>
              </div>
              <div className="space-y-2">
                {pendingToday.map(block => (
                  <StudyBlockCard key={block.id} block={block} isToday onUpdate={handleBlockUpdate} />
                ))}
                {doneToday.map(block => (
                  <StudyBlockCard key={block.id} block={block} isToday onUpdate={handleBlockUpdate} />
                ))}
              </div>
            </div>
          )}

          {data.threadHighlights?.length > 0 && (
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">Course threads</h2>
              <ul className="space-y-2">
                {data.threadHighlights.map((t) => (
                  <li key={t.label} className="text-sm text-text-secondary">
                    <span className="text-text-primary font-medium">{t.label}</span>
                    {t.summary && <span className="text-text-muted"> — {t.summary}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Main grid: focus + continue ── */}
          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 mb-5">
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">This week focus</h2>
              <div className="space-y-2">
                {data.suggestions?.length ? data.suggestions.map((s) => (
                  <div key={s.courseId} className="text-sm text-text-secondary">
                    <span className="text-text-primary font-medium">{s.courseName}</span>
                    <span className="text-text-muted"> — {s.reason}</span>
                    <p className="text-xs text-text-muted">{s.action}</p>
                  </div>
                )) : <p className="text-xs text-text-muted">No suggestions yet. Add courses and lectures first.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">Continue</h2>
              <div className="space-y-2">
                {data.continueItems?.length ? data.continueItems.map((item) => (
                  <div key={`${item.courseId}-${item.lectureId}`} className="text-sm">
                    <p className="text-text-primary font-medium truncate">{item.lectureName}</p>
                    <p className="text-xs text-text-muted">{item.courseName} · {profileLabel(item.profile)} · {item.progress}</p>
                  </div>
                )) : <p className="text-xs text-text-muted">Open a lecture once and it will appear here.</p>}
              </div>
            </div>
          </div>

          {/* ── Course roster ── */}
          <div className="space-y-2">
            {data.items.map((item) => {
              const courseBlocks = allBlocks.filter(b => b.courseId === item.courseId);
              const courseDone = courseBlocks.filter(b => b.status === 'done').length;
              return (
                <div key={item.courseId} className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-text-primary font-semibold">{item.courseName}</p>
                      <p className="text-xs text-text-muted">
                        {item.semester} · {item.moduleGroup} · Priority {item.priority}/5 · {item.credits} ECTS
                      </p>
                    </div>
                    <div className="text-xs text-text-muted text-right flex-shrink-0">
                      <p>Lectures: {item.lectureCount}</p>
                      {item.behindCount > 0 && (
                        <p className="text-orange-400">Behind: {item.behindCount}</p>
                      )}
                      {courseBlocks.length > 0 && (
                        <p className="text-accent">{courseDone}/{courseBlocks.length} blocks done</p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value }) {
  return (
    <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
      <p className="text-xs text-text-muted">{label}</p>
      <p className="text-xl font-bold text-text-primary mt-1">{value}</p>
    </div>
  );
}
