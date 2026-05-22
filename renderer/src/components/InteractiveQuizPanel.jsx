import React, { useState, useEffect, useMemo } from 'react';

export default function InteractiveQuizPanel({ lecturePath, lectureProfile }) {
  const [quizData, setQuizData] = useState(null);
  const [answers, setAnswers] = useState({});
  const [checked, setChecked] = useState(false);
  const [loading, setLoading] = useState(false);
  const [attempts, setAttempts] = useState([]);

  useEffect(() => {
    setQuizData(null);
    setAnswers({});
    setChecked(false);
    setAttempts([]);
    if (!lecturePath) return;
    window.api.loadLectureQuizInteractive({ lecturePath }).then((res) => {
      if (res?.success && res.quiz?.questions?.length) {
        setQuizData(res.quiz);
        setAttempts(res.attempts || []);
      }
    });
  }, [lecturePath]);

  const score = useMemo(() => calculateScore(quizData, answers, checked), [quizData, answers, checked]);

  const generate = async () => {
    if (!lecturePath) return;
    setLoading(true);
    setChecked(false);
    setAnswers({});
    const result = await window.api.generateLectureQuizInteractive({
      lecturePath,
      difficulty: 'medium',
      questionCount: 6,
    });
    if (result?.success) setQuizData(result.quiz);
    setLoading(false);
  };

  const checkAll = async () => {
    if (!quizData?.questions?.length) return;
    const allAnswered = quizData.questions.every((q) => answers[q.id]?.selectedIndex !== undefined);
    if (!allAnswered) return;
    setChecked(true);
    const s = calculateScore(quizData, answers, true);
    const result = await window.api.saveLectureQuizAttempt({
      lecturePath,
      difficulty: 'medium',
      answers,
      score: s,
    });
    if (result?.success) setAttempts((prev) => [result.attempt, ...prev].slice(0, 5));
  };

  const hasQuiz = quizData?.questions?.length > 0;
  const allAnswered = hasQuiz && quizData.questions.every((q) => answers[q.id]?.selectedIndex !== undefined);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-text-muted">
          Active recall — {lectureProfile === 'math_stats' ? 'method & interpretation' : 'concepts & connections'}
        </p>
        <div className="flex gap-1.5">
          {hasQuiz && (
            <>
              <button
                onClick={() => { setAnswers({}); setChecked(false); }}
                className="px-2.5 py-1 rounded-lg text-xs text-text-muted border border-border-DEFAULT hover:bg-bg-hover"
              >
                Reset
              </button>
              <button
                onClick={checkAll}
                disabled={!allAnswered || checked}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-accent text-white disabled:opacity-40"
              >
                Check all
              </button>
            </>
          )}
          <button
            onClick={generate}
            disabled={loading}
            className="px-2.5 py-1 rounded-lg text-xs border border-border-DEFAULT hover:bg-bg-hover disabled:opacity-40"
          >
            {loading ? 'Generating…' : hasQuiz ? 'New quiz' : 'Generate quiz'}
          </button>
        </div>
      </div>

      {checked && hasQuiz && (
        <div className="px-3 py-2 rounded-lg bg-bg-tertiary text-xs">
          Score:{' '}
          <span className={score.correct === score.total ? 'text-green-400 font-semibold' : 'text-yellow-300 font-semibold'}>
            {score.correct}/{score.total}
          </span>
        </div>
      )}

      {hasQuiz ? (
        <div className="space-y-4">
          {quizData.questions.map((q, idx) => (
            <QuestionBlock
              key={q.id}
              q={q}
              idx={idx}
              selected={answers[q.id]?.selectedIndex}
              checked={checked}
              onSelect={(optIdx) => !checked && setAnswers((prev) => ({ ...prev, [q.id]: { selectedIndex: optIdx } }))}
            />
          ))}
        </div>
      ) : (
        <p className="text-sm text-text-muted italic py-6 text-center">
          Generate an interactive quiz to test yourself on this whole lecture.
        </p>
      )}
    </div>
  );
}

function QuestionBlock({ q, idx, selected, checked, onSelect }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-text-primary font-medium">{idx + 1}. {q.prompt}</p>
      <div className="space-y-1.5">
        {q.options.map((option, optIdx) => {
          const isSelected = selected === optIdx;
          const isCorrect = checked && optIdx === q.correctIndex;
          const isWrong = checked && isSelected && optIdx !== q.correctIndex;
          return (
            <button
              key={optIdx}
              type="button"
              onClick={() => onSelect(optIdx)}
              disabled={checked}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors
                ${isCorrect ? 'bg-green-500/15 border-green-500/40 text-green-300' :
                  isWrong ? 'bg-red-500/15 border-red-500/40 text-red-300' :
                  isSelected ? 'bg-accent/20 border-accent/40 text-text-primary' :
                  'bg-bg-tertiary border-border-DEFAULT text-text-secondary hover:bg-bg-hover'
                }`}
            >
              <span className="inline-block w-5 text-text-muted text-xs">{String.fromCharCode(65 + optIdx)}.</span>
              {option}
            </button>
          );
        })}
      </div>
      {checked && selected !== undefined && (
        <p className={`text-xs px-1 ${selected === q.correctIndex ? 'text-green-400' : 'text-yellow-300'}`}>
          {selected === q.correctIndex ? '✓' : '✗'} {q.explanation}
        </p>
      )}
    </div>
  );
}

function calculateScore(quizData, answers, checked) {
  const questions = quizData?.questions || [];
  let correct = 0;
  for (const q of questions) {
    const sel = answers[q.id]?.selectedIndex;
    if (sel !== undefined && checked && sel === q.correctIndex) correct += 1;
  }
  return { total: questions.length, correct };
}
