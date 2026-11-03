import clsx from "clsx";
import { Check } from "lucide-react";
import { PIPELINE, pipelinePosition } from "@/lib/status.ts";

/** 排队 → 开发 → 审核 → 发布；终止态（失败、驳回、取消）整体置灰 */
export function Pipeline({ stage, attention }: { stage: string; attention?: boolean }) {
  const { index, closed } = pipelinePosition(stage);
  return (
    <ol className="flex items-center" aria-label="任务进度">
      {PIPELINE.map((label, i) => {
        const done = !closed && i < index;
        const current = !closed && i === index;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center last:flex-none" aria-current={current ? "step" : undefined}>
            <div className="flex items-center gap-2">
              <span
                className={clsx(
                  "grid size-6 shrink-0 place-items-center rounded-full border text-[11px] font-medium",
                  done && "border-ink bg-ink text-card",
                  current && (attention ? "border-ink bg-card text-ink" : "border-signal bg-signal text-white"),
                  !done && !current && "border-line-strong bg-card text-ink-3",
                )}
              >
                {done ? <Check className="size-3.5" aria-hidden /> : i + 1}
              </span>
              <span className={clsx("text-[13px]", current ? "font-semibold text-ink" : done ? "text-ink" : "text-ink-3")}>{label}</span>
            </div>
            {i < PIPELINE.length - 1 && <span className={clsx("mx-3 h-px min-w-4 flex-1", done ? "bg-ink" : "bg-line-strong")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
