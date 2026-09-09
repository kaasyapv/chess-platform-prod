"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { Check, X, Info } from "lucide-react";

type Toast = { id: number; text: string; kind: "success" | "error" | "info" };
type ToastFn = (text: string, kind?: Toast["kind"]) => void;

const ToastContext = createContext<ToastFn>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

/** Dark toast cards, error variant with a red X icon - Playmate's observed
 *  toast pattern (design-tokens.md §States). */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback<ToastFn>((text, kind = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [{ id, text, kind }, ...t]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      {/* Top-right, clear of the 64px topbar. Newest on top so a burst of
       *  toasts (points, then "class ended") reads in order. */}
      <div className="fixed top-20 right-4 z-[100] flex flex-col gap-2 no-print items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="toast-in bg-surface-3 border border-border rounded-card px-4 py-3 shadow-lg flex items-center gap-3 min-w-64 max-w-96 text-sm"
          >
            <span
              className={
                t.kind === "error"
                  ? "text-destructive"
                  : t.kind === "success"
                    ? "text-success"
                    : "text-primary-hover"
              }
            >
              {t.kind === "error" ? <X size={16} /> : t.kind === "success" ? <Check size={16} /> : <Info size={16} />}
            </span>
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
