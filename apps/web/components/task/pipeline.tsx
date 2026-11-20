import clsx from "clsx";
import { Check, LoaderCircle, X } from "lucide-react";
import { DELIVERY_PIPELINE, PIPELINE, type TaskProgress, type Tone } from "@/lib/status.ts";

export function Pipeline({ position, tone, delivery }: { delivery?: boolean; position: TaskProgress["step"]; tone: Tone }) {
  const { index, closed } = position;
  const labels = delivery ? DELIVERY_PIPELINE : PIPELINE;
  return (
    <ol className={clsx("isolate flex items-start", !delivery && "max-w-[42rem]")} aria-label="任务进度">
      {labels.map((label, i) => {
        const done = !closed && i < index;
        const current = !closed && i === index;
        const failed = current && tone === "bad";
        const running = current && tone === "live";
        return (
          <li key={label} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 px-0.5 text-center" aria-current={current ? "step" : undefined}>
            {i < labels.length - 1 && (
              <span className={clsx("absolute left-1/2 top-[11px] h-0.5 w-full", done ? "bg-ok/50" : "bg-line-strong")} aria-hidden />
            )}
            <span className={clsx(
              "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border",
              done && "border-ok/40 bg-ok-soft text-ok",
              failed && "border-bad/40 bg-bad-soft text-bad",
              current && !failed && "border-signal/40 bg-signal-soft text-signal",
              !done && !current && "border-line-strong bg-card text-ink-3",
            )}>
              {done ? <Check className="size-3.5" aria-hidden />
                : failed ? <X className="size-3.5" aria-hidden />
                : running ? <LoaderCircle className="size-4 motion-safe:animate-spin" aria-hidden />
                : <span className="size-1.5 rounded-full bg-current" aria-hidden />}
            </span>
            <span className={clsx("text-xs leading-4", failed ? "font-semibold text-bad" : current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3")}>
              {label}
              {done && <span className="sr-only">（已完成）</span>}
              {failed && <span className="sr-only">（失败）</span>}
              {running && <span className="sr-only">（进行中）</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
