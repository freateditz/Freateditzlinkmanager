'use client';
import { useEffect, useState } from 'react';

type Toast = { id: string; message: string; variant: 'success' | 'error' | 'info' };

let listeners: Array<(t: Toast) => void> = [];
let id = 0;

export function showToast(message: string, variant: Toast['variant'] = 'info') {
  const t: Toast = { id: `t${++id}`, message, variant };
  listeners.forEach((l) => l(t));
}

export function useToast() {
  return showToast;
}

const variantClasses: Record<Toast['variant'], string> = {
  success: 'border-success/30 bg-success/10 text-success',
  error: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-border bg-bg-elevated text-text-primary',
};

export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    const fn = (t: Toast) => {
      setToasts((prev) => [...prev, t]);
      setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== t.id)), 3200);
    };
    listeners.push(fn);
    return () => {
      listeners = listeners.filter((l) => l !== fn);
    };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          aria-live="polite"
          className={[
            'pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-soft backdrop-blur-sm',
            'animate-slideIn',
            variantClasses[t.variant],
          ].join(' ')}
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
