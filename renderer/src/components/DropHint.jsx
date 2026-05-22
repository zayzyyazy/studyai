import React from 'react';

export default function DropHint({ onOpenPdf }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center animate-fade-in">
        <div className="text-7xl mb-6 opacity-60">📄</div>
        <h2 className="text-xl font-semibold text-text-secondary mb-2">
          Drop a lecture PDF anywhere
        </h2>
        <p className="text-text-muted text-sm max-w-xs mx-auto leading-relaxed">
          Drag a PDF from Finder or use Smart Add PDF for auto-placement, semantic naming, quick overview, and quiz generation.
        </p>
        <button
          onClick={onOpenPdf}
          className="mt-5 px-4 py-2 rounded-lg bg-accent hover:bg-accent-dark text-white text-sm font-semibold transition-colors"
        >
          Smart Add PDF
        </button>
        <div className="mt-8 flex items-center justify-center gap-2 text-text-muted text-xs">
          <span className="bg-bg-secondary border border-border-DEFAULT px-2 py-1 rounded text-text-muted">← Select a course</span>
          <span>or drop a PDF to get started</span>
        </div>
      </div>
    </div>
  );
}
