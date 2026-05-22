import { useState, useEffect, useRef } from 'react';

export function useDropZone(onDrop) {
  const [isDragging, setIsDragging] = useState(false);
  const dragCounterRef = useRef(0);
  const resetTimerRef = useRef(null);

  useEffect(() => {
    const clearResetTimer = () => {
      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
        resetTimerRef.current = null;
      }
    };

    const forceReset = () => {
      clearResetTimer();
      dragCounterRef.current = 0;
      setIsDragging(false);
    };

    const handleDragEnter = (e) => {
      e.preventDefault();
      clearResetTimer();
      dragCounterRef.current++;
      if (e.dataTransfer?.items?.length > 0) {
        setIsDragging(true);
      }
    };

    const handleDragLeave = (e) => {
      e.preventDefault();
      dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
      if (dragCounterRef.current === 0) {
        resetTimerRef.current = setTimeout(forceReset, 50);
      }
    };

    const handleDragOver = (e) => {
      e.preventDefault();
    };

    // Capture phase: ALWAYS resets drag visual state when any drop happens on
    // the page, even when local handlers call stopPropagation() and consume
    // the event first. This prevents isDragging from getting stuck.
    const handleDropCapture = () => {
      forceReset();
    };

    // Bubble phase: only fires when the drop was NOT consumed by a local handler
    const handleDrop = (e) => {
      e.preventDefault();
      forceReset();

      const files = Array.from(e.dataTransfer?.files || []).filter(
        f => f.name.toLowerCase().endsWith('.pdf')
      );

      if (files.length > 0 && onDrop) {
        onDrop(files.map(f => ({ name: f.name, path: f.path })));
      }
    };

    const handleDragEnd = () => {
      forceReset();
    };

    const handleVisibilityChange = () => {
      if (document.hidden) forceReset();
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDropCapture, true); // capture — always resets
    window.addEventListener('drop', handleDrop);              // bubble — processes file
    window.addEventListener('dragend', handleDragEnd);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      clearResetTimer();
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDropCapture, true);
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragend', handleDragEnd);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [onDrop]);

  return { isDragging };
}
