import React, { useEffect, useState, useCallback } from 'react';
import StudyBlockCard from '../components/StudyBlockCard';
import { blockTypeToTab, plannerActionToTab } from '../utils/studyNavigation';

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

function progressLabel(progress) {
  if (progress === 'done') return 'Done';
  if (progress === 'active') return 'In progress';
  if (progress === 'started') return 'Started';
  return 'Not started';
}

function LectureLinkRow({ title, subtitle, meta, onClick, accent }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded-lg border px-3 py-2.5 transition-colors group
        ${accent
          ? 'border-accent/30 bg-accent/10 hover:bg-accent/15 hover:border-accent/50'
          : 'border-border-subtle bg-bg-tertiary/50 hover:bg-bg-hover hover:border-border-DEFAULT'
        }`}
    >
      <p className="text-sm font-medium text-text-primary truncate group-hover:text-accent transition-colors">
        {title}
      </p>
      {subtitle && <p className="text-xs text-text-muted mt-0.5 truncate">{subtitle}</p>}
      {meta && <p className="text-[10px] text-text-muted/80 mt-1">{meta}</p>}
      <p className="text-[10px] text-accent mt-1 opacity-0 group-hover:opacity-100 transition-opacity">Open lecture →</p>
    </button>
  );
}

export default function DashboardPage({ courses = [], onOpenPdf, onOpenPlanner, onOpenLecture }) {
  const [data, setData] = useState(null);
  const [planCtx, setPlanCtx] = useState(null);
  const [todayBlocks, setTodayBlocks] = useState([]);

  const today = getTodayDow();

  const refresh = useCallback(() => {
    window.api.getDashboard().then(setData);
    window.api.getPlannerContext().then((ctx) => {
      setPlanCtx(ctx);
      if (ctx.weeklyPlan && isSameWeek(ctx.weeklyPlan.weekStartDate)) {
        const dow = getTodayDow();
        const blocks = (ctx.weeklyPlan.blocks || [])
          .filter((b) => b.dayOfWeek === dow)
          .map((b) => ({ ...b, suggestedTab: blockTypeToTab(b.blockType) }));
        setTodayBlocks(blocks);
      } else {
        setTodayBlocks([]);
      }
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const openLecture = useCallback((payload) => {
    if (!onOpenLecture) return;
    onOpenLecture({
      courseId: payload.courseId,
      lectureId: payload.lectureId,
      lecturePath: payload.lecturePath,
      lectureName: payload.lectureName,
      tab: payload.tab || 'overview',
    });
  }, [onOpenLecture]);

  const openCourse = useCallback((courseId, options = {}) => {
    const continueForCourse = data?.continueItems?.find((c) => c.courseId === courseId);
    if (options.lectureId || options.lecturePath) {
      openLecture({ courseId, ...options });
      return;
    }
    if (continueForCourse) {
      openLecture({
        courseId,
        lectureId: continueForCourse.lectureId,
        lecturePath: continueForCourse.lecturePath,
        lectureName: continueForCourse.lectureName,
        tab: options.tab || 'overview',
      });
      return;
    }
    onOpenLecture?.({ courseId, tab: 'overview' });
  }, [data?.continueItems, onOpenLecture, openLecture]);

  async function handleBlockUpdate(blockId, changes) {
    const result = await window.api.updatePlanBlock({ blockId, changes });
    if (result.success && result.plan) {
      const dow = getTodayDow();
      const blocks = (result.plan.blocks || [])
        .filter((b) => b.dayOfWeek === dow)
        .map((b) => ({ ...b, suggestedTab: blockTypeToTab(b.blockType) }));
      setTodayBlocks(blocks);
    }
  }

  function handleBlockOpen(block) {
    openLecture({
      courseId: block.courseId,
      lectureId: block.lectureId,
      lecturePath: block.lecturePath,
      lectureName: block.lectureName,
      tab: block.suggestedTab || blockTypeToTab(block.blockType),
    });
  }

  if (!data) {
    return <div className="h-full flex items-center justify-center text-text-muted">Loading…</div>;
  }

  const plan = planCtx?.weeklyPlan && isSameWeek(planCtx?.weeklyPlan?.weekStartDate) ? planCtx.weeklyPlan : null;
  const weeklyHoursMax = planCtx?.weeklyHoursMax || 14;
  const budgetMin = weeklyHoursMax * 60;
  const allBlocks = plan?.blocks || [];
  const doneMin = allBlocks.filter((b) => b.status === 'done').reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const plannedMin = allBlocks.reduce((s, b) => s + (b.estimatedMinutes || 0), 0);
  const donePct = budgetMin > 0 ? Math.min(100, Math.round(doneMin / budgetMin * 100)) : 0;
  const plannedPct = budgetMin > 0 ? Math.min(100, Math.round(plannedMin / budgetMin * 100)) : 0;

  const pendingToday = todayBlocks.filter((b) => b.status === 'pending');
  const doneToday = todayBlocks.filter((b) => b.status === 'done');

  const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  const todayName = DAY_NAMES[today];
  const next = data.nextAction;

  return (
    <div className="h-full flex flex-col bg-bg-primary overflow-hidden">
      <div className="h-8 drag-region flex-shrink-0" />
      <div className="flex-1 overflow-y-auto no-drag px-6 pb-8">
        <div className="max-w-5xl mx-auto">

          <div className="flex items-center justify-between mb-5">
            <div>
              <h1 className="text-xl font-bold text-text-primary">Dashboard</h1>
              <p className="text-sm text-text-muted">
                {todayName}, {new Date().toLocaleDateString('en', { month: 'long', day: 'numeric', year: 'numeric' })}
              </p>
            </div>
            <button type="button" onClick={onOpenPdf} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-semibold hover:bg-accent/90 transition-colors">
              + Add PDFs
            </button>
          </div>

          {next?.courseId && (
            <div className="rounded-xl border border-accent/35 bg-accent/10 p-4 mb-5">
              <p className="text-[10px] uppercase tracking-wide text-accent font-semibold mb-1">Suggested next</p>
              <p className="text-sm font-semibold text-text-primary">{next.lectureName}</p>
              <p className="text-xs text-text-muted mt-0.5">{next.courseName} · {next.minutes ? `${next.minutes} min` : ''} {next.action ? `· ${next.action}` : ''}</p>
              {next.reason && <p className="text-xs text-text-secondary mt-2">{next.reason}</p>}
              <button
                type="button"
                onClick={() => openLecture({
                  courseId: next.courseId,
                  lectureId: next.lectureId,
                  lecturePath: next.lecturePath,
                  lectureName: next.lectureName,
                  tab: plannerActionToTab(next.action),
                })}
                className="mt-3 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:bg-accent/90"
              >
                Open lecture
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-3 mb-5">
            <MetricCard label="Total lectures" value={data.totalLectures} />
            <MetricCard label="Started" value={data.startedLectures} />
            <MetricCard label="Course load" value={`${data.totalCredits || 0} ECTS`} />
          </div>

          {plan ? (
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h2 className="text-sm font-semibold text-text-primary">This Week&apos;s Budget</h2>
                  <p className="text-xs text-text-muted">{weeklyHoursMax}h total · {allBlocks.length} blocks planned</p>
                </div>
                <button
                  type="button"
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
                type="button"
                onClick={onOpenPlanner}
                className="flex-shrink-0 px-3 py-2 rounded-lg bg-accent text-white text-xs font-semibold hover:bg-accent/90 transition-colors"
              >
                Go to Planner
              </button>
            </div>
          )}

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
                {pendingToday.map((block) => (
                  <StudyBlockCard
                    key={block.id}
                    block={block}
                    isToday
                    onUpdate={handleBlockUpdate}
                    onOpen={handleBlockOpen}
                  />
                ))}
                {doneToday.map((block) => (
                  <StudyBlockCard
                    key={block.id}
                    block={block}
                    isToday
                    onUpdate={handleBlockUpdate}
                    onOpen={handleBlockOpen}
                  />
                ))}
              </div>
            </div>
          )}

          {data.threadHighlights?.length > 0 && (
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 mb-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">Course threads</h2>
              <p className="text-[10px] text-text-muted mb-2">Recurring themes across lectures — open where you left off</p>
              <div className="space-y-2">
                {data.threadHighlights.map((t) => (
                  <LectureLinkRow
                    key={`${t.courseId}-${t.lectureId}-${t.label}`}
                    title={t.label || t.threadName}
                    subtitle={`${t.courseName}${t.lectureName ? ` · ${t.lectureName}` : ''}`}
                    meta={[t.sequenceLabel, t.position, t.prerequisite].filter(Boolean).join(' · ')}
                    onClick={() => openLecture({
                      courseId: t.courseId,
                      lectureId: t.lectureId,
                      lecturePath: t.lecturePath,
                      lectureName: t.lectureName,
                      tab: 'overview',
                    })}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid lg:grid-cols-[1.1fr_0.9fr] gap-4 mb-5">
            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">This week focus</h2>
              <div className="space-y-2">
                {data.suggestions?.length ? data.suggestions.map((s) => (
                  <LectureLinkRow
                    key={s.courseId}
                    title={s.courseName}
                    subtitle={s.reason}
                    meta={s.action}
                    onClick={() => openCourse(s.courseId)}
                  />
                )) : <p className="text-xs text-text-muted">No suggestions yet. Add courses and lectures first.</p>}
              </div>
            </div>

            <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
              <h2 className="text-sm font-semibold text-text-primary mb-2">Continue</h2>
              <div className="space-y-2">
                {data.continueItems?.length ? data.continueItems.map((item) => (
                  <LectureLinkRow
                    key={`${item.courseId}-${item.lectureId}`}
                    title={item.lectureName}
                    subtitle={item.courseName}
                    meta={`${profileLabel(item.profile)} · ${progressLabel(item.progress)}`}
                    onClick={() => openLecture({
                      courseId: item.courseId,
                      lectureId: item.lectureId,
                      lecturePath: item.lecturePath,
                      tab: 'overview',
                    })}
                  />
                )) : <p className="text-xs text-text-muted">Open a lecture once and it will appear here.</p>}
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <h2 className="text-sm font-semibold text-text-primary px-1">Your courses</h2>
            {data.items.map((item) => {
              const courseBlocks = allBlocks.filter((b) => b.courseId === item.courseId);
              const courseDone = courseBlocks.filter((b) => b.status === 'done').length;
              const course = courses.find((c) => c.id === item.courseId);
              return (
                <button
                  key={item.courseId}
                  type="button"
                  onClick={() => openCourse(item.courseId)}
                  className="w-full rounded-xl border border-border-DEFAULT bg-bg-secondary p-4 text-left hover:border-accent/40 hover:bg-bg-hover/40 transition-colors group"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 flex items-center gap-3">
                      <span className="text-xl flex-shrink-0">{course?.emoji || '📚'}</span>
                      <div className="min-w-0">
                        <p className="text-text-primary font-semibold truncate group-hover:text-accent transition-colors">{item.courseName}</p>
                        <p className="text-xs text-text-muted">
                          {item.semester} · {item.moduleGroup} · Priority {item.priority}/5 · {item.credits} ECTS
                        </p>
                        <p className="text-[10px] text-accent mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          Open course →
                        </p>
                      </div>
                    </div>
                    <div className="text-xs text-text-muted text-right flex-shrink-0">
                      <p>{item.lectureCount} lectures</p>
                      {item.behindCount > 0 && (
                        <p className="text-orange-400">{item.behindCount} not started</p>
                      )}
                      {courseBlocks.length > 0 && (
                        <p className="text-accent">{courseDone}/{courseBlocks.length} blocks done</p>
                      )}
                    </div>
                  </div>
                </button>
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
