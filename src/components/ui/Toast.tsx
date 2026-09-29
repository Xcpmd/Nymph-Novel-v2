'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

interface ToastValue {
  push: (text: string, kind?: ToastKind) => void;
}

const ToastContext = createContext<ToastValue | null>(null);

const KIND_STYLE: Record<ToastKind, string> = {
  info: 'border-line text-text',
  success: 'border-accent/60 text-accent',
  error: 'border-danger/70 text-danger',
};

const KIND_ICON: Record<ToastKind, string> = {
  info: 'fa-circle-info',
  success: 'fa-circle-check',
  error: 'fa-triangle-exclamation',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const push = useCallback((text: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setItems((previous) => [...previous, { id, kind, text }]);
    setTimeout(() => {
      setItems((previous) => previous.filter((item) => item.id !== id));
    }, 3600);
  }, []);

  const value = useMemo<ToastValue>(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-6 left-1/2 z-100 flex w-[min(92vw,26rem)] -translate-x-1/2 flex-col gap-2">
        {items.map((item) => (
          <div
            key={item.id}
            className={`rise-in pointer-events-auto flex items-center gap-2 rounded-2xl border bg-surface/95 px-4 py-3 text-sm shadow-soft backdrop-blur ${KIND_STYLE[item.kind]}`}
          >
            <i className={`fa-solid ${KIND_ICON[item.kind]}`} aria-hidden />
            <span className="flex-1">{item.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastValue {
  const context = useContext(ToastContext);
  return context ?? { push: () => undefined };
}
