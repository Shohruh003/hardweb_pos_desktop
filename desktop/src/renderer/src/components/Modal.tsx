import React from 'react';

// Markazlashgan modal (tahrirlash formalari uchun)
export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 animate-overlay-in p-4"
      onClick={onClose}
    >
      <div
        className="bg-surface border border-border rounded-2xl w-[440px] max-h-[90vh] overflow-auto animate-pop-in"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3.5 border-b border-border font-bold flex items-center justify-between">
          <span>{title}</span>
          <button onClick={onClose} className="text-muted hover:text-text text-xl leading-none">
            ✕
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
