import clsx from "clsx";
import { Check, X } from "lucide-react";
import { TaskPhaseIcon } from "@/components/task-list/task-status-pill.tsx";
import { DELIVERY_PIPELINE, PIPELINE, type TaskProgress, type Tone } from "@/lib/status.ts";

export function Pipeline({ position, tone, delivery, running }: { delivery?: boolean; position: TaskProgress["step"]; tone: Tone; running: boolean }) {
  const { index, closed } = position;
  const steps = delivery ? DELIVERY_PIPELINE : PIPELINE;
  return (
    <ol className={clsx("isolate flex items-start", !delivery && "max-w-[42rem]")} aria-label="任务进度">
      {steps.map(({ label, phase }, i) => {
        const done = !closed && i < index;
        const current = !closed && i === index;
        const failed = current && tone === "bad";
        const active = current && running;
        const leadsToActive = running && i === index - 1;
        return (
          <li key={label} data-task-phase={phase} className="relative flex min-w-0 flex-1 flex-col items-center gap-1.5 px-0.5 text-center" aria-current={current ? "step" : undefined}>
            {i < steps.length - 1 && (
              <span
                data-task-phase={leadsToActive ? steps[index]?.phase : undefined}
                className={clsx("absolute left-1/2 top-[11px] h-0.5 w-full overflow-hidden", leadsToActive ? "task-pipeline-flow" : done ? "bg-ok/50" : "bg-line-strong")}
                aria-hidden />
            )}
            <span className={clsx(
              "relative z-10 grid size-6 shrink-0 place-items-center rounded-full border",
              failed ? "border-bad/40 bg-bad-soft text-bad" : "task-pipeline-node",
              active && "task-status-change",
            )}>
              {done ? <Check className="size-3.5" aria-hidden />
                : failed ? <X className="size-3.5" aria-hidden />
                : <TaskPhaseIcon phase={phase} running={active} />}
            </span>
            <span className={clsx("text-xs leading-4", failed ? "font-semibold text-bad" : current ? "task-pipeline-label font-semibold" : done ? "text-ink-2" : "text-ink-3")}>
              {label}
              {done && <span className="sr-only">（已完成）</span>}
              {failed && <span className="sr-only">（失败）</span>}
              {active && <span className="sr-only">（进行中）</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
