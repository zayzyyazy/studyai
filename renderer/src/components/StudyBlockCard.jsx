import React from 'react';

const BLOCK_CONFIG = {
  overview:      { label: 'Overview',    icon: '👁',  colorClass: 'text-blue-400',   bgClass: 'bg-blue-400/10'   },
  deep_dive:     { label: 'Deep Dive',   icon: '🔬', colorClass: 'text-purple-400', bgClass: 'bg-purple-400/10' },
  quiz:          { label: 'Quiz',        icon: '✅',  colorClass: 'text-green-400',  bgClass: 'bg-green-400/10'  },
  review:        { label: 'Review',      icon: '🔁',  colorClass: 'text-yellow-400', bgClass: 'bg-yellow-400/10' },
  revisit:       { label: 'Revisit',     icon: '↩',  colorClass: 'text-orange-400', bgClass: 'bg-orange-400/10' },
  catch_up:      { label: 'Catch Up',    icon: '⚡',  colorClass: 'text-red-400',    bgClass: 'bg-red-400/10'    },
  practice:      { label: 'Practice',    icon: '📝',  colorClass: 'text-teal-400',   bgClass: 'bg-teal-400/10'   },
  consolidation: { label: 'Consolidate', icon: '🧩',  colorClass: 'text-indigo-400', bgClass: 'bg-indigo-400/10' }
};

export default function StudyBlockCard({ block, isToday, onUpdate, onOpen }) {
  const cfg = BLOCK_CONFIG[block.blockType] || BLOCK_CONFIG.review;
  const isDone = block.status === 'done';
  const isSkipped = block.status === 'skipped';
  const isInactive = isDone || isSkipped;
  const canOpen = Boolean(onOpen && block.courseId && (block.lecturePath || block.lectureId));

  const handleOpen = (e) => {
    e?.stopPropagation?.();
    if (!canOpen) return;
    onOpen({
      courseId: block.courseId,
      lectureId: block.lectureId,
      lecturePath: block.lecturePath,
      lectureName: block.lectureName,
      tab: block.suggestedTab,
      blockType: block.blockType,
    });
  };

  return (
    <div
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      onClick={canOpen ? handleOpen : undefined}
      onKeyDown={canOpen ? (e) => { if (e.key === 'Enter') handleOpen(e); } : undefined}
      className={`rounded-xl border transition-all ${
        isDone    ? 'border-border-subtle bg-bg-secondary/40 opacity-55' :
        isSkipped ? 'border-border-subtle bg-bg-secondary/25 opacity-35' :
        isToday   ? 'border-accent/25 bg-bg-secondary shadow-sm' :
                  'border-border-DEFAULT bg-bg-secondary'
      } ${canOpen ? 'cursor-pointer hover:border-accent/40 hover:bg-bg-hover/30' : ''}`}
    >
      <div className="p-3">
        <div className="flex items-start gap-3">

          <div className={`flex-shrink-0 w-8 h-8 rounded-lg ${cfg.bgClass} flex items-center justify-center text-base`}>
            {isDone ? '✓' : isSkipped ? '—' : cfg.icon}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-0.5">
              <span className={`text-[11px] font-bold uppercase tracking-wider ${cfg.colorClass}`}>
                {cfg.label}
              </span>
              <span className="text-[11px] text-text-muted">{block.estimatedMinutes}min</span>
              {isToday && !isInactive && (
                <span className="text-[10px] bg-accent/20 text-accent px-1.5 py-0.5 rounded-full font-semibold">
                  Today
                </span>
              )}
              {isDone && (
                <span className="text-[10px] bg-green-400/15 text-green-400 px-1.5 py-0.5 rounded-full font-semibold">
                  Done
                </span>
              )}
              {isSkipped && (
                <span className="text-[10px] bg-bg-hover text-text-muted px-1.5 py-0.5 rounded-full font-semibold">
                  Skipped
                </span>
              )}
            </div>
            <p className={`text-sm font-semibold leading-tight truncate ${isDone ? 'line-through text-text-muted' : 'text-text-primary'}`}>
              {block.lectureName}
            </p>
            <p className="text-xs text-text-muted mt-0.5">{block.courseName}</p>
            {block.aiRationale && !isInactive && (
              <p className="text-[11px] text-text-muted/80 mt-1 leading-snug italic">
                {block.aiRationale}
              </p>
            )}
            {canOpen && !isInactive && (
              <p className="text-[10px] text-accent mt-1.5">Open lecture →</p>
            )}
          </div>

          <div className="flex-shrink-0 flex flex-col gap-1" onClick={(e) => e.stopPropagation()}>
            {canOpen && (
              <button
                type="button"
                onClick={handleOpen}
                className="px-2 py-1 rounded-lg bg-accent/15 text-accent text-[11px] font-semibold hover:bg-accent/25 transition-colors"
              >
                Open
              </button>
            )}
            {!isInactive && (
              <>
                <button
                  type="button"
                  onClick={() => onUpdate(block.id, { status: 'done' })}
                  className="px-2 py-1 rounded-lg bg-green-500/15 text-green-400 text-[11px] font-semibold hover:bg-green-500/25 transition-colors"
                >
                  Done
                </button>
                <button
                  type="button"
                  onClick={() => onUpdate(block.id, { status: 'skipped' })}
                  className="px-2 py-1 rounded-lg bg-bg-hover text-text-muted text-[11px] hover:text-text-secondary transition-colors"
                >
                  Skip
                </button>
              </>
            )}
            {isInactive && (
              <button
                type="button"
                onClick={() => onUpdate(block.id, { status: 'pending' })}
                className="px-2 py-1 rounded-lg bg-bg-hover text-text-muted text-[11px] hover:text-text-secondary transition-colors"
              >
                Undo
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
