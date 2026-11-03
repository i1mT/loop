"use client";
import clsx from "clsx";
import { CheckCircle2, XCircle } from "lucide-react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

interface Toast {
  id: number;
  kind: "ok" | "error";
  text: string;
}
const Ctx = createContext<(kind: Toast["kind"], text: string) => void>(() => {});
let seq = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Toast["kind"], text: string) => {
    const id = ++seq;
    setItems((xs) => [...xs, { id, kind, text }]);
    const ms = kind === "error" ? 6000 : text.length > 24 ? 12000 : 3500;
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), ms);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] grid gap-2" role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={clsx("rise pointer-events-auto flex max-w-sm items-start gap-2 rounded-card border bg-card px-3.5 py-2.5 text-[13px] shadow-pop", t.kind === "error" ? "border-bad/40" : "border-line")}>
            {t.kind === "error" ? <XCircle className="mt-0.5 size-4 shrink-0 text-bad" aria-hidden /> : <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" aria-hidden />}
            <span>{t.text}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);
