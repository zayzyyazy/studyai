import React, { useState, useEffect, useRef } from 'react';
import LectureMarkdown from './LectureMarkdown';

export default function LectureNotesPanel({
  lecturePath,
  courseName,
  lectureTitle,
  initialNotes = '',
  initialStudyCard = null,
  onSaved,
  onCardGenerated,
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [studyCard, setStudyCard] = useState(initialStudyCard);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    setNotes(initialNotes || '');
    setStudyCard(initialStudyCard);
    setSavedAt(null);
    setCardError('');
  }, [lecturePath, initialNotes, initialStudyCard]);

  useEffect(() => {
    if (!lecturePath) return;
    window.api.loadStudyCard({ lecturePath }).then((res) => {
      if (res?.success) setStudyCard(res.card);
    });
  }, [lecturePath]);

  const persist = async (text) => {
    if (!lecturePath) return;
    setSaving(true);
    const result = await window.api.saveLectureNotes({ lecturePath, notes: text });
    setSaving(false);
    if (result?.success) {
      setSavedAt(new Date());
      onSaved?.(text);
    }
  };

  const handleChange = (e) => {
    const text = e.target.value;
    setNotes(text);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => persist(text), 800);
  };

  const generateCard = async () => {
    if (!lecturePath) return;
    if (!notes.trim()) {
      setCardError('Write something in your note space first.');
      return;
    }
    setCardLoading(true);
    setCardError('');
    await persist(notes);
    const result = await window.api.generateStudyCard({
      lecturePath,
      courseName,
      lectureTitle,
    });
    setCardLoading(false);
    if (result?.success) {
      setStudyCard(result.card);
      onCardGenerated?.(result.card);
    } else {
      setCardError(result?.error || 'Could not generate card');
    }
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <p className="text-sm font-semibold text-text-primary">My note space</p>
            <p className="text-[10px] text-text-muted mt-0.5">
              Private scratchpad — AI uses this (not the lecture summary) to build your card
            </p>
          </div>
          <span className="text-[10px] text-text-muted">
            {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
          </span>
        </div>
        <textarea
          value={notes}
          onChange={handleChange}
          placeholder="What clicked, what confused you, examples, mnemonics, exam angles, links to earlier lectures…"
          className="w-full min-h-[220px] bg-bg-tertiary border border-border-DEFAULT rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y leading-relaxed"
        />
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            onClick={generateCard}
            disabled={cardLoading || !notes.trim()}
            className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40 hover:bg-accent/90"
          >
            {cardLoading ? 'Building card…' : studyCard ? 'Refresh study card' : 'Create study card from my notes'}
          </button>
          {cardError && <p className="text-xs text-red-400">{cardError}</p>}
        </div>
      </section>

      {studyCard && (
        <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold text-text-primary">Your study card</p>
            {studyCard.generatedAt && (
              <span className="text-[10px] text-text-muted">
                {new Date(studyCard.generatedAt).toLocaleString()}
              </span>
            )}
          </div>
          {studyCard.gist && (
            <p className="text-sm text-text-secondary mb-3 leading-relaxed border-l-2 border-accent pl-3">
              {studyCard.gist}
            </p>
          )}
          <div className="markdown-body">
            <LectureMarkdown>
              {studyCard.markdown || ''}
            </LectureMarkdown>
          </div>
        </section>
      )}
    </div>
  );
}
