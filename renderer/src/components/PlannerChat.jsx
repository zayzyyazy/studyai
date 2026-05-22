import React, { useState, useRef, useEffect } from 'react';
import LectureMarkdown from './LectureMarkdown';

const QUICK_PROMPTS = [
  'What should I study today?',
  'Which course needs the most attention right now?',
  'I only have 90 minutes today — what should I do?',
  'I\'m tired today — give me a lighter plan.',
  'What am I most behind on?',
  'Rebuild my plan with statistics as the top priority.',
];

export default function PlannerChat({ weeklyHours, onPlanUpdate, onClose }) {
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: "Hi! I'm your study planning assistant. I know your actual courses, lectures, and current weekly plan.\n\nAsk me what to study today, how to rebalance your week, or anything about your study schedule."
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  async function handleSend(text) {
    const q = (text || input).trim();
    if (!q || loading) return;
    setInput('');
    setError('');

    const newMessages = [...messages, { role: 'user', content: q }];
    setMessages(newMessages);
    setLoading(true);

    const apiMessages = newMessages.filter(m => m.role !== 'system').map(m => ({
      role: m.role,
      content: m.content
    }));

    const result = await window.api.plannerChat({ messages: apiMessages, weeklyHours });
    setLoading(false);

    if (result.success) {
      setMessages(prev => [...prev, { role: 'assistant', content: result.reply }]);
      if (result.planUpdate) {
        onPlanUpdate(result.planUpdate);
      }
    } else {
      setError(result.error || 'Unknown error');
    }
  }

  const showQuickPrompts = messages.length <= 1;

  return (
    <div className="w-80 flex-shrink-0 flex flex-col bg-bg-secondary border-l border-border-subtle h-full">

      {/* Drag region + header */}
      <div className="h-8 drag-region flex-shrink-0" />
      <div className="px-4 pb-3 flex items-center justify-between no-drag flex-shrink-0">
        <div>
          <h3 className="text-sm font-bold text-text-primary">AI Planner</h3>
          <p className="text-[11px] text-text-muted">Knows your courses & current plan</p>
        </div>
        <button
          onClick={onClose}
          className="w-6 h-6 flex items-center justify-center rounded-md text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors text-lg leading-none"
        >
          ×
        </button>
      </div>

      <div className="flex-shrink-0 h-px bg-border-subtle" />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3 no-drag">
        {messages.map((msg, i) => (
          <div key={i} className={msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
            <div className={`max-w-[90%] rounded-xl px-3 py-2 text-sm ${
              msg.role === 'user'
                ? 'bg-accent/25 text-text-primary'
                : 'bg-bg-tertiary text-text-secondary'
            }`}>
              {msg.role === 'assistant' ? (
                <div className="prose-planner">
                  <LectureMarkdown>{msg.content}</LectureMarkdown>
                </div>
              ) : (
                <p className="whitespace-pre-wrap">{msg.content}</p>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-bg-tertiary rounded-xl px-3 py-2.5">
              <div className="flex gap-1 items-center">
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '120ms' }} />
                <span className="w-1.5 h-1.5 rounded-full bg-text-muted animate-bounce" style={{ animationDelay: '240ms' }} />
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="px-3 py-2 rounded-lg bg-red-500/10 border border-red-500/25 text-red-400 text-xs">
            {error}
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Quick prompts */}
      {showQuickPrompts && (
        <div className="px-3 py-2 no-drag flex-shrink-0">
          <p className="text-[10px] text-text-muted uppercase tracking-wider mb-1.5">Try asking:</p>
          <div className="space-y-1">
            {QUICK_PROMPTS.slice(0, 4).map((prompt, i) => (
              <button
                key={i}
                onClick={() => handleSend(prompt)}
                className="w-full text-left text-[11px] px-2.5 py-1.5 rounded-lg bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-bg-hover transition-colors leading-snug"
              >
                {prompt}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-shrink-0 h-px bg-border-subtle" />

      {/* Input */}
      <div className="px-3 py-3 no-drag flex-shrink-0">
        <div className="flex gap-2 items-end">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            placeholder="Ask about your study plan…"
            rows={2}
            className="flex-1 bg-bg-tertiary border border-border-DEFAULT rounded-lg px-2.5 py-2 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors"
          />
          <button
            onClick={() => handleSend()}
            disabled={loading || !input.trim()}
            className="flex-shrink-0 w-8 h-8 flex items-center justify-center rounded-lg bg-accent text-white text-base font-bold disabled:opacity-40 hover:bg-accent/90 transition-colors self-end"
          >
            ↑
          </button>
        </div>
        <p className="text-[10px] text-text-muted mt-1.5">Enter to send · Shift+Enter for newline</p>
      </div>
    </div>
  );
}
