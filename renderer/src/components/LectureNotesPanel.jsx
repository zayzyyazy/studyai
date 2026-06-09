import React, { useState, useEffect, useRef } from 'react';
import LectureMarkdown from './LectureMarkdown';

export default function LectureNotesPanel({
  lecturePath,
  courseName,
  lectureTitle,
  initialNotes = '',
  initialStudyCard = null,
  initialNoteCards = [],
  onSaved,
  onCardGenerated,
  onCardsChange,
}) {
  const [tab, setTab] = useState('cards');
  const [notes, setNotes] = useState(initialNotes);
  const [cards, setCards] = useState(initialNoteCards);
  const [studyCard, setStudyCard] = useState(initialStudyCard);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState('');
  const [expandedId, setExpandedId] = useState(null);
  const timerRef = useRef(null);

  useEffect(() => {
    setNotes(initialNotes || '');
    setCards(initialNoteCards || []);
    setStudyCard(initialStudyCard);
    setSavedAt(null);
    setCardError('');
  }, [lecturePath, initialNotes, initialStudyCard, initialNoteCards]);

  useEffect(() => {
    if (!lecturePath) return;
    window.api.loadStudyCard({ lecturePath }).then((res) => {
      if (res?.success) setStudyCard(res.card);
    });
    window.api.listNoteCards({ lecturePath }).then((res) => {
      if (res?.success) {
        setCards(res.cards || []);
        onCardsChange?.(res.cards || []);
      }
    });
  }, [lecturePath, onCardsChange]);

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

  const deleteCard = async (cardId) => {
    const res = await window.api.deleteNoteCard({ lecturePath, cardId });
    if (res?.success) {
      setCards(res.cards || []);
      onCardsChange?.(res.cards || []);
      if (expandedId === cardId) setExpandedId(null);
    }
  };

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return (
    <div className="space-y-4">
      <div className="flex gap-1 p-1 rounded-lg bg-bg-tertiary border border-border-DEFAULT">
        <button
          type="button"
          onClick={() => setTab('cards')}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium ${tab === 'cards' ? 'bg-accent text-white' : 'text-text-secondary'}`}
        >
          Saved cards ({cards.length})
        </button>
        <button
          type="button"
          onClick={() => setTab('scratch')}
          className={`flex-1 py-1.5 rounded-md text-xs font-medium ${tab === 'scratch' ? 'bg-accent text-white' : 'text-text-secondary'}`}
        >
          Scratchpad
        </button>
      </div>

      {tab === 'cards' && (
        <section className="space-y-3">
          <p className="text-xs text-text-muted">
            Deep dives and expansions you saved appear here as cards — your personal lecture deck.
          </p>
          {cards.length === 0 ? (
            <p className="text-sm text-text-muted text-center py-10 rounded-xl border border-dashed border-border-DEFAULT">
              No saved cards yet. In Deep Dive, use “Save to Notes” on content you want to keep.
            </p>
          ) : (
            cards.map((card) => (
              <article
                key={card.id}
                className="rounded-xl border border-border-DEFAULT bg-bg-secondary overflow-hidden"
              >
                <button
                  type="button"
                  onClick={() => setExpandedId(expandedId === card.id ? null : card.id)}
                  className="w-full text-left px-4 py-3 hover:bg-bg-hover transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-text-primary truncate">{card.title}</p>
                      <p className="text-[10px] text-text-muted mt-0.5">
                        {typeLabel(card.type)} · {card.mode || 'explain'}
                        {card.savedAt ? ` · ${new Date(card.savedAt).toLocaleString()}` : ''}
                      </p>
                      {card.gist && (
                        <p className="text-xs text-text-secondary mt-1 line-clamp-2">{card.gist}</p>
                      )}
                    </div>
                    <span className="text-text-muted text-xs flex-shrink-0">{expandedId === card.id ? '▾' : '▸'}</span>
                  </div>
                </button>
                {expandedId === card.id && (
                  <div className="px-4 pb-4 border-t border-border-subtle">
                    <div className="markdown-body pt-3 max-h-96 overflow-y-auto">
                      <LectureMarkdown>{card.markdown}</LectureMarkdown>
                    </div>
                    <button
                      type="button"
                      onClick={() => deleteCard(card.id)}
                      className="mt-3 text-[10px] text-red-400/90 hover:underline"
                    >
                      Delete card
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
        </section>
      )}

      {tab === 'scratch' && (
        <section className="rounded-xl border border-border-DEFAULT bg-bg-secondary p-4">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-sm font-semibold text-text-primary">My note space</p>
              <p className="text-[10px] text-text-muted mt-0.5">
                Private scratchpad — AI uses this to build your study card
              </p>
            </div>
            <span className="text-[10px] text-text-muted">
              {saving ? 'Saving…' : savedAt ? `Saved ${savedAt.toLocaleTimeString()}` : ''}
            </span>
          </div>
          <textarea
            value={notes}
            onChange={handleChange}
            placeholder="What clicked, what confused you, exam angles…"
            className="w-full min-h-[200px] bg-bg-tertiary border border-border-DEFAULT rounded-xl px-4 py-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent resize-y leading-relaxed"
          />
          <div className="flex items-center gap-2 mt-3">
            <button
              type="button"
              onClick={generateCard}
              disabled={cardLoading || !notes.trim()}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium disabled:opacity-40"
            >
              {cardLoading ? 'Building…' : studyCard ? 'Refresh study card' : 'Create study card'}
            </button>
            {cardError && <p className="text-xs text-red-400">{cardError}</p>}
          </div>
        </section>
      )}

      {studyCard && tab === 'scratch' && (
        <section className="rounded-xl border border-accent/30 bg-accent/5 p-4">
          <p className="text-sm font-semibold text-text-primary mb-2">Your study card</p>
          {studyCard.gist && (
            <p className="text-sm text-text-secondary mb-3 border-l-2 border-accent pl-3">{studyCard.gist}</p>
          )}
          <LectureMarkdown>{studyCard.markdown || ''}</LectureMarkdown>
        </section>
      )}
    </div>
  );
}

function typeLabel(type) {
  if (type === 'subtopic') return 'Go deeper';
  if (type === 'ask') return 'Ask AI';
  return 'Deep dive';
}
