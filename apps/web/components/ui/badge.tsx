import clsx from "clsx";
import type { ReactNode } from "react";
import type { Tone } from "@/lib/status.ts";

const TONES: Record<Tone, { pill: string; dot: string }> = {
  idle: { pill: "bg-sunken text-ink-2", dot: "bg-ink-3" },
  live: { pill: "bg-signal-soft text-[#a63a10]", dot: "bg-signal" },
  review: { pill: "bg-card text-ink border border-ink", dot: "bg-card border border-ink" },
  ok: { pill: "bg-ok-soft text-ok", dot: "bg-ok" },
  bad: { pill: "bg-bad-soft text-bad", dot: "bg-bad" },
  warn: { pill: "bg-warn-soft text-warn", dot: "bg-warn" },
};

/** 状态胶囊可用图标替换默认圆点。 */
export function StatusPill({ tone, children, icon }: { tone: Tone; children: ReactNode; icon?: ReactNode }) {
  const t = TONES[tone];
  return (
    <span className={clsx("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium leading-5 whitespace-nowrap", t.pill)}>
      {icon ?? <span className={clsx("size-1.5 rounded-full", t.dot)} aria-hidden />}
      {children}
    </span>
  );
}

export function Chip({ children, className, title }: { children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-control border border-line bg-card px-1.5 py-0.5 text-xs text-ink-2", className)}>
      {children}
    </span>
  );
}

export function CountBadge({ n, tone = "warn" }: { n: number; tone?: "warn" | "ink" }) {
  if (n <= 0) return null;
  return <span className={clsx("num ml-auto rounded-full px-1.5 text-[11px] leading-5", tone === "warn" ? "bg-signal text-white" : "bg-sunken text-ink-2")}>{n > 99 ? "99+" : n}</span>;
}
