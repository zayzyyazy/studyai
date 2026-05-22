import React from 'react';
import LectureMarkdown from './LectureMarkdown';
import { getDeepDiveTopicSections, slugifyTopic } from '../utils/lectureStructure';

export default function DeepDivePanel({
  lecture,
  topicSections,
  selectedTopic,
  onSelectTopic,
  customTopic,
  onCustomTopicChange,
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
}) {
  const effectiveTopic = customTopic.trim() || selectedTopic;
  const canGenerate = !!effectiveTopic && !deepDiveLoading;
  const hasDeepDive = !!deepDiveMarkdown;
  const hasQuiz = topicQuizData?.questions?.length > 0;
  const allAnswered = hasQuiz && topicQuizData.questions.every((q) => quizAnswers[q.id]?.selectedIndex !== undefined);
  const sections = topicSections?.length ? topicSections : getDeepDiveTopicSections(lecture);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5">
        <p className="text-xs text-text-muted mb-3 font-medium">
          Kernthema wählen, dann Unterthema — oder das Hauptthema direkt vertiefen
        </p>
        <div className="space-y-3">
          {sections.map((section) => {
            const themeActive = !customTopic && selectedTopic === section.label;
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
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary leading-snug">{section.label}</p>
                      {section.role && (
                        <p className="text-[10px] text-accent mt-0.5">{section.role}</p>
                      )}
                    </div>
                    <span className="text-[10px] text-text-muted flex-shrink-0">Hauptthema →</span>
                  </div>
                  {section.why && (
                    <p className="text-[10px] text-text-muted mt-1 line-clamp-2">{section.why}</p>
                  )}
                </button>
                {(section.subtopics || []).length > 0 && (
                  <div className="px-2 py-2 space-y-1">
                    {section.subtopics.map((sub) => {
                      const subActive = !customTopic && selectedTopic === sub.label;
                      return (
                        <button
                          key={`${section.label}-${sub.label}`}
                          type="button"
                          onClick={() => { onSelectTopic(sub.label); onCustomTopicChange(''); }}
                          className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors
                            ${subActive
                              ? 'bg-accent/20 text-text-primary border border-accent/40'
                              : 'text-text-secondary hover:bg-bg-hover border border-transparent'
                            }`}
                        >
                          <span className="text-[10px] text-text-muted mr-1.5">↳</span>
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
        <div className="flex gap-2 mt-3">
          <input
            type="text"
            placeholder="Or type another concept…"
            value={customTopic}
            onChange={(e) => onCustomTopicChange(e.target.value)}
            className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-3 py-2 text-sm text-text-primary min-w-0"
          />
          <button
            type="button"
            onClick={onGenerate}
            disabled={!canGenerate}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 flex-shrink-0"
          >
            {deepDiveLoading ? 'Teaching…' : 'Deep dive'}
          </button>
        </div>
      </div>

      {hasDeepDive && (
        <>
          <LectureMarkdown>{deepDiveMarkdown}</LectureMarkdown>
          <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5">
            <p className="text-xs text-text-muted mb-2 font-medium">Go deeper on a subtopic</p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Subtopic from the deep dive…"
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
                Expand
              </button>
            </div>
            {subtopicMarkdown && (
              <div className="mt-3 pt-3 border-t border-border-subtle">
                <LectureMarkdown>{subtopicMarkdown}</LectureMarkdown>
              </div>
            )}
          </div>
          <QuizSection
            hasQuiz={hasQuiz}
            topicQuizData={topicQuizData}
            quizAnswers={quizAnswers}
            onQuizAnswersChange={onQuizAnswersChange}
            quizChecked={quizChecked}
            quizScore={quizScore}
            quizAttempts={quizAttempts}
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
          No topics detected yet — try Regenerate on Overview first.
        </p>
      )}
    </div>
  );
}

function QuizSection(props) {
  const {
    hasQuiz, topicQuizData, quizAnswers, onQuizAnswersChange, quizChecked, quizScore,
    quizAttempts, deepDiveLoading, deepDiveSlug, onGenerateQuiz, onCheckAll, onResetQuiz,
  } = props;
  const allAnswered = hasQuiz && topicQuizData.questions.every((q) => quizAnswers[q.id]?.selectedIndex !== undefined);

  return (
    <div className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-3.5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-medium text-text-muted">Knowledge check</p>
        <div className="flex gap-1.5">
          {hasQuiz && (
            <>
              <button type="button" onClick={onCheckAll} disabled={!allAnswered || quizChecked} className="px-2.5 py-1 rounded-lg text-xs bg-accent text-white disabled:opacity-40">Check</button>
              <button type="button" onClick={onResetQuiz} className="px-2.5 py-1 rounded-lg text-xs border border-border-DEFAULT">Reset</button>
            </>
          )}
          <button type="button" onClick={onGenerateQuiz} disabled={deepDiveLoading || !deepDiveSlug} className="px-2.5 py-1 rounded-lg text-xs border border-border-DEFAULT disabled:opacity-40">
            {hasQuiz ? 'New' : 'Quiz'}
          </button>
        </div>
      </div>
      {quizChecked && hasQuiz && (
        <p className="text-xs mb-3">Score: {quizScore.correct}/{quizScore.total}</p>
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
        <p className="text-xs text-text-muted italic">Quiz this deep dive after generating it.</p>
      )}
    </div>
  );
}

export { slugifyTopic };
