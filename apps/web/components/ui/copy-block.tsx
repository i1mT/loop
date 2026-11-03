"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** 代码或文本块，右上角一键复制 */
/** copy：复制的内容，默认就是显示的 text（显示做了遮盖时用它指定真实内容） */
export function CopyBlock({ text, className = "", copy }: { text: string; className?: string; copy?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="relative">
      <pre className={`num overflow-x-auto whitespace-pre-wrap break-all rounded-control bg-sunken p-3 pr-11 text-xs leading-relaxed ${className}`}>{text}</pre>
      <button
        type="button"
        aria-label="复制"
        className="absolute right-2 top-2 grid size-7 cursor-pointer place-items-center rounded-control text-ink-2 hover:bg-card hover:text-ink"
        onClick={() => {
          void navigator.clipboard?.writeText(copy ?? text);
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        }}
      >
        {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      </button>
    </div>
  );
}
