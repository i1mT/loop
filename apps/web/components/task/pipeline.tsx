import clsx from "clsx";
import { Check, X } from "lucide-react";
import { PIPELINE, type TaskProgress, type Tone } from "@/lib/status.ts";

/** 排队 → 开发 → 审核 → 发布。发布失败停在发布节点。 */
export function Pipeline({ position, tone }: { position: TaskProgress["step"]; tone: Tone }) {
  const { index, closed } = position;
  return (
    <ol className="flex max-w-[42rem] items-center" aria-label="任务进度">
      {PIPELINE.map((label, i) => {
        const done = !closed && i < index;
        const current = !closed && i === index;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none" aria-current={current ? "step" : undefined}>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "grid size-5 shrink-0 place-items-center rounded-full border",
                  done && "border-line bg-card text-ink-2",
                  current && (tone === "bad" ? "border-bad/30 bg-bad-soft text-bad" : "border-signal/30 bg-signal-soft text-signal"),
                  !done && !current && "border-line-strong text-ink-3",
                )}
              >
                {done ? <Check className="size-3" aria-hidden /> : current && tone === "bad" ? <X className="size-3" aria-hidden /> : <span className={clsx("size-1.5 rounded-full", current ? "bg-current" : "bg-line-strong")} aria-hidden />}
              </span>
              <span className={clsx("whitespace-nowrap text-[13px]", current ? "font-semibold text-ink" : done ? "text-ink-2" : "text-ink-3")}>{label}</span>
            </div>
            {i < PIPELINE.length - 1 && <span className={clsx("mx-1.5 h-px min-w-1 flex-1 bg-line sm:mx-3")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
