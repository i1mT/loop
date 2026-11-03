"use client";
import clsx from "clsx";
import { ChevronDown } from "lucide-react";
import { useId, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";

const control =
  "w-full rounded-control border border-line-strong bg-card px-3 text-sm text-ink placeholder:text-ink-3 transition-colors hover:border-ink-3 focus:border-ink focus:outline-none disabled:opacity-60 disabled:bg-sunken";

/** 标签在输入框上方，说明在下方，错误在说明位置替换。不用占位符当标签。 */
export function Field({ label, hint, error, children, htmlFor, action }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; htmlFor?: string; action?: ReactNode }) {
  const auto = useId();
  const id = htmlFor ?? auto;
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        {action}
      </div>
      {children(id)}
      {error ? (
        <p role="alert" className="text-xs text-bad">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-ink-2">{hint}</p>
      ) : null}
    </div>
  );
}

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={clsx(control, "h-9", className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={clsx(control, "py-2 leading-relaxed resize-y min-h-20", className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...rest} className={clsx(control, "h-9 appearance-none pr-8 cursor-pointer", className)}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
    </div>
  );
}

export function Checkbox({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  const id = useId();
  return (
    <div className="flex items-start gap-2.5">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-4 cursor-pointer accent-[#1b1a17]" />
      <label htmlFor={id} className="cursor-pointer">
        <span className="text-sm text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink-2">{hint}</span>}
      </label>
    </div>
  );
}
