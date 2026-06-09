import React from 'react';
import LectureMarkdown from './LectureMarkdown';
import { getDeepDiveTopicSections, slugifyTopic } from '../utils/lectureStructure';
import { DEEP_DIVE_MODES, modeLabel } from '../utils/deepDiveModes';

function exploreKey(topic = '', subtopic = '') {
  return `${String(topic).toLowerCase().trim()}::${String(subtopic || '').toLowerCase().trim()}`;
}

function isExplored(exploredSet, topic, subtopic = '') {
  if (!exploredSet?.size) return false;
  return exploredSet.has(exploreKey(topic, subtopic))
    || exploredSet.has(exploreKey(topic, ''))
    || (subtopic && exploredSet.has(exploreKey(subtopic, '')));
}

export default function DeepDivePanel({
  lecture,
  topicSections,
  selectedTopic,
  onSelectTopic,
  customTopic,
  onCustomTopicChange,
  deepDiveMode,
  onDeepDiveModeChange,
  deepDiveMarkdown,
  deepDiveSlug,
  deepDiveLoading,
  subtopic,
  onSubtopicChange,
  subtopicMarkdown,
  topicQuizData,
  quizAnswers,
  onQuizAnswersChange,
  quizChecked,
  quizScore,
  quizAttempts,
  onGenerate,
  onSubtopicDive,
  onGenerateQuiz,
  onCheckAll,
  onResetQuiz,
  onSaveDeepDive,
  onSaveSubtopic,
  onPickSuggestion,
  deepSuggestions = [],
  suggestionsLoading = false,
  lectureComplete = false,
  completeMessage = '',
  deepStudyCoverage = null,
  exploredSet = null,
  isGerman = true,
  lectureProfile = '',
}) {
  const effectiveTopic = customTopic.trim() || selectedTopic;
  const canGenerate = !!effectiveTopic && !deepDiveLoading;
  const hasDeepDive = !!deepDiveMarkdown;
  const sections = topicSections?.length ? topicSections : getDeepDiveTopicSections(lecture);
  const profileHint = profileDisplayLabel(lectureProfile, isGerman);
  const explored = exploredSet || new Set();

  return (
    <div className="space-y-4">
      {lectureComplete && (
        <div className="rounded-xl border border-green-500/40 bg-green-500/10 px-4 py-3">
          <p className="text-sm font-semibold text-green-400">
            {isGerman ? 'Vorlesung durch für heute' : 'Lecture complete for now'}
          </p>
          <p className="text-xs text-text-secondary mt-1">{completeMessage}</p>
        </div>
      )}

      {deepStudyCoverage && !lectureComplete && (
        <p className="text-[10px] text-text-muted">
          {isGerman ? 'Fortschritt' : 'Progress'}:{' '}
          {Math.round((deepStudyCoverage.ratio || 0) * 100)}%
          {deepStudyCoverage.subtopicsTotal > 0
            ? ` · ${deepStudyCoverage.subtopicsCovered}/${deepStudyCoverage.subtopicsTotal} ${isGerman ? 'Unterthemen' : 'subtopics'}`
            : ` · ${deepStudyCoverage.themesCovered}/${deepStudyCoverage.themesTotal} ${isGerman ? 'Kernthemen' : 'themes'}`}
        </p>
      )}

      <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className="text-xs text-text-muted font-medium">
            {isGerman ? 'Kernthema wählen, dann Lernmodus' : 'Pick a core topic, then a learning mode'}
          </p>
          {profileHint && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent/15 text-accent font-medium flex-shrink-0">
              {profileHint}
            </span>
          )}
        </div>
        <div className="space-y-3">
          {sections.map((section) => {
            const themeActive = !customTopic && selectedTopic === section.label;
            const themeDone = isExplored(explored, section.label, '');
            return (
              <div
                key={section.label}
                className="rounded-lg border border-border-DEFAULT bg-bg-tertiary overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => { onSelectTopic(section.label); onCustomTopicChange(''); }}
                  className={`w-full text-left px-3 py-2.5 transition-colors border-b border-border-subtle/50
                    ${themeActive ? 'bg-accent/15' : 'hover:bg-bg-hover'}`}
                >
                  <p className="text-sm font-semibold text-text-primary leading-snug flex items-center gap-2">
                    {themeDone && <span className="text-green-400 text-xs">✓</span>}
                    {section.label}
                  </p>
                  {section.role && <p className="text-[10px] text-accent mt-0.5">{section.role}</p>}
                </button>
                {(section.subtopics || []).length > 0 && (
                  <div className="px-2 py-2 space-y-1">
                    {section.subtopics.map((sub) => {
                      const subActive = !customTopic && selectedTopic === sub.label;
                      const subDone = isExplored(explored, sub.label, '') || isExplored(explored, section.label, sub.label);
                      return (
                        <button
                          key={`${section.label}-${sub.label}`}
                          type="button"
                          onClick={() => {
                            onSelectTopic(sub.label);
                            onCustomTopicChange('');
                            onSubtopicChange?.(sub.label);
                          }}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                            ${subActive ? 'bg-accent/20 text-text-primary border border-accent/40' : 'text-text-secondary hover:bg-bg-hover border border-transparent'}`}
                        >
                          <span className="text-[10px] text-text-muted mr-1.5">{subDone ? '✓' : '↳'}</span>
                          {sub.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {effectiveTopic && (
          <div className="mt-4 pt-3 border-t border-border-subtle">
            <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
              {isGerman ? 'Lernmodus' : 'Learning mode'}
            </p>
            <div className="flex flex-wrap gap-1.5 mb-3">
              {DEEP_DIVE_MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => onDeepDiveModeChange(m.id)}
                  className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors
                    ${deepDiveMode === m.id ? 'bg-accent text-white' : 'bg-bg-tertiary text-text-secondary hover:bg-bg-hover border border-border-DEFAULT'}`}
                  title={isGerman ? m.descDe : m.descEn}
                >
                  {modeLabel(m.id, isGerman)}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={isGerman ? 'Anderes Konzept…' : 'Other concept…'}
                value={customTopic}
                onChange={(e) => onCustomTopicChange(e.target.value)}
                className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-sm min-w-0"
              />
              <button
                type="button"
                onClick={onGenerate}
                disabled={!canGenerate}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 flex-shrink-0"
              >
                {deepDiveLoading ? '…' : (isGerman ? 'Erzeugen' : 'Generate')}
              </button>
            </div>
          </div>
        )}
      </div>

      {hasDeepDive && (
        <>
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-text-muted font-medium">{isGerman ? 'Deep Dive' : 'Deep Dive'}</p>
            {onSaveDeepDive && (
              <button
                type="button"
                onClick={onSaveDeepDive}
                disabled={deepDiveLoading}
                className="text-[10px] px-2.5 py-1 rounded-lg border border-accent/40 text-accent hover:bg-accent/10"
              >
                {isGerman ? 'In Notes speichern' : 'Save to Notes'}
              </button>
            )}
          </div>
          <LectureMarkdown>{deepDiveMarkdown}</LectureMarkdown>

          <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5 space-y-3">
            <p className="text-xs text-text-muted font-medium">{isGerman ? 'Noch tiefer' : 'Go deeper'}</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={isGerman ? 'Unterthema…' : 'Subtopic…'}
                value={subtopic}
                onChange={(e) => onSubtopicChange(e.target.value)}
                className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-sm min-w-0"
              />
              <button
                type="button"
                onClick={onSubtopicDive}
                disabled={deepDiveLoading || !deepDiveSlug || !subtopic.trim()}
                className="px-3 py-2 rounded-lg border border-border-DEFAULT text-sm disabled:opacity-40"
              >
                {deepDiveLoading ? '…' : (isGerman ? 'Erweitern' : 'Expand')}
              </button>
            </div>

            {subtopicMarkdown && (
              <div className="pt-3 border-t border-border-subtle space-y-2">
                <div className="flex justify-end">
                  {onSaveSubtopic && (
                    <button
                      type="button"
                      onClick={onSaveSubtopic}
                      className="text-[10px] px-2.5 py-1 rounded-lg border border-accent/40 text-accent"
                    >
                      {isGerman ? 'Unterthema in Notes' : 'Save subtopic to Notes'}
                    </button>
                  )}
                </div>
                <LectureMarkdown>{subtopicMarkdown}</LectureMarkdown>
              </div>
            )}

            {(suggestionsLoading || deepSuggestions.length > 0) && !lectureComplete && (
              <div className="pt-3 border-t border-border-subtle">
                <p className="text-[10px] uppercase tracking-wide text-text-muted font-semibold mb-2">
                  {isGerman ? 'Als Nächstes' : 'Suggested next'}
                </p>
                {suggestionsLoading ? (
                  <p className="text-xs text-text-muted">{isGerman ? 'Denke nach…' : 'Thinking…'}</p>
                ) : (
                  <div className="space-y-1.5">
                    {deepSuggestions.map((s) => (
                      <button
                        key={s.label}
                        type="button"
                        onClick={() => onPickSuggestion?.(s)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-bg-tertiary hover:bg-accent/10 border border-border-DEFAULT text-sm"
                      >
                        <span className="font-medium text-text-primary">{s.label}</span>
                        {s.reason && (
                          <span className="block text-[10px] text-text-muted mt-0.5">{s.reason}</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <QuizBlock
            isGerman={isGerman}
            hasQuiz={topicQuizData?.questions?.length > 0}
            topicQuizData={topicQuizData}
            quizAnswers={quizAnswers}
            onQuizAnswersChange={onQuizAnswersChange}
            quizChecked={quizChecked}
            quizScore={quizScore}
            deepDiveLoading={deepDiveLoading}
            deepDiveSlug={deepDiveSlug}
            onGenerateQuiz={onGenerateQuiz}
            onCheckAll={onCheckAll}
            onResetQuiz={onResetQuiz}
          />
        </>
      )}

      {!hasDeepDive && sections.length === 0 && (
        <p className="text-sm text-text-muted text-center py-8">
          {isGerman ? 'Zuerst Overview regenerieren.' : 'Regenerate Overview first.'}
        </p>
      )}
    </div>
  );
}

function QuizBlock(props) {
  const {
    isGerman, hasQuiz, topicQuizData, quizAnswers, onQuizAnswersChange, quizChecked, quizScore,
    deepDiveLoading, deepDiveSlug, onGenerateQuiz, onCheckAll, onResetQuiz,
  } = props;
  const allAnswered = hasQuiz && topicQuizData.questions.every((q) => quizAnswers[q.id]?.selectedIndex !== undefined);

  return (
    <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-text-muted">{isGerman ? 'Wissenscheck' : 'Knowledge check'}</p>
        <div className="flex gap-1.5">
          {hasQuiz && (
            <>
              <button type="button" onClick={onCheckAll} disabled={!allAnswered || quizChecked} className="px-2.5 py-1 rounded-lg text-xs bg-accent text-white disabled:opacity-40">Check</button>
              <button type="button" onClick={onResetQuiz} className="px-2.5 py-1 rounded-lg text-xs border border-border-DEFAULT">Reset</button>
            </>
          )}
          <button type="button" onClick={onGenerateQuiz} disabled={deepDiveLoading || !deepDiveSlug} className="px-2.5 py-1 rounded-lg text-xs border border-border-DEFAULT disabled:opacity-40">
            {hasQuiz ? (isGerman ? 'Neu' : 'New') : 'Quiz'}
          </button>
        </div>
      </div>
      {quizChecked && hasQuiz && (
        <p className="text-xs mb-3">{quizScore.correct}/{quizScore.total}</p>
      )}
      {hasQuiz ? (
        <div className="space-y-4">
          {topicQuizData.questions.map((q, idx) => (
            <div key={q.id} className="space-y-2">
              <p className="text-sm font-medium">{idx + 1}. {q.prompt}</p>
              {q.options.map((opt, optIdx) => (
                <button
                  key={optIdx}
                  type="button"
                  disabled={quizChecked}
                  onClick={() => onQuizAnswersChange((prev) => ({ ...prev, [q.id]: { selectedIndex: optIdx } }))}
                  className="w-full text-left px-3 py-2 rounded-lg text-sm border bg-bg-tertiary border-border-DEFAULT"
                >
                  {String.fromCharCode(65 + optIdx)}. {opt}
                </button>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-text-muted italic">{isGerman ? 'Nach dem Deep Dive verfügbar.' : 'Available after deep dive.'}</p>
      )}
    </div>
  );
}

function profileDisplayLabel(profile, isGerman) {
  const map = {
    programming: isGerman ? 'Programmierung' : 'Programming',
    math_stats: isGerman ? 'Mathe/Statistik' : 'Math/Stats',
    psychology: isGerman ? 'Psychologie' : 'Psychology',
    applied_methods: isGerman ? 'Methoden' : 'Methods',
    reading_heavy: isGerman ? 'Lesestoff' : 'Reading',
    conceptual: isGerman ? 'Konzeptuell' : 'Conceptual',
  };
  return map[profile] || '';
}

export { slugifyTopic };
