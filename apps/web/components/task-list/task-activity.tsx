import clsx from "clsx";
import { AgentName } from "@/components/agent/agent-icon.tsx";
import { isTaskExecuting, taskStageInfo } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";

export function TaskActivity({ tasks }: { tasks: TaskItem[] }) {
  const agents = new Map<string, number>();
  let executing = 0;
  let waiting = 0;
  let needsReview = 0;
  for (const task of tasks) {
    const { group } = taskStageInfo(task);
    if (isTaskExecuting(task)) {
      executing++;
      agents.set(task.agent, (agents.get(task.agent) ?? 0) + 1);
    } else if (group === "active") {
      waiting++;
    } else if (group === "attention" || group === "review") {
      needsReview++;
    }
  }
  return (
    <div aria-label="任务执行概况" role="group" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-canvas/60 px-4 py-3 text-xs">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className={clsx("inline-flex items-center gap-1.5", executing ? "font-semibold text-[#a63a10]" : "text-ink-2")}>
          <span className="inline-flex h-4 items-center gap-0.5" aria-hidden>
            {[0, 1, 2].map((i) => <span key={i} className={clsx("h-2.5 w-0.5 rounded-full bg-current", executing && "motion-safe:animate-[task-activity-beat_1.1s_ease-in-out_infinite]")} style={{ animationDelay: `${i * -0.18}s` }} />)}
          </span>
          <span className="num">{executing}</span> 正在执行
        </span>
        <span className="text-ink-2"><span className="num">{waiting}</span> 等待执行</span>
        <span className="text-ink-2"><span className="num">{needsReview}</span> 待处理</span>
      </div>
      {agents.size > 0 && <ul aria-label="智能体正在执行的任务数" className="flex flex-wrap gap-1.5">
        {[...agents].sort(([a, ac], [b, bc]) => bc - ac || a.localeCompare(b)).map(([kind, count]) => (
          <li key={kind} className="inline-flex items-center gap-1.5 rounded-full border border-line bg-card px-2 py-0.5">
            <AgentName kind={kind} size={14} /><span className="num text-ink-2">{count}</span>
          </li>
        ))}
      </ul>}
    </div>
  );
}
