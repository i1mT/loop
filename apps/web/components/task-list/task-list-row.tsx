import clsx from "clsx";
import { GitPullRequest, Monitor } from "lucide-react";
import Link from "next/link";
import { AgentName } from "@/components/agent/agent-icon.tsx";
import { Chip } from "@/components/ui/badge.tsx";
import { timeAgo } from "@/lib/format.ts";
import { isTaskExecuting } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";
import { TaskStatusPill } from "./task-status-pill.tsx";

export function TaskListRow({ task, showProject, className }: { task: TaskItem; showProject?: boolean; className?: string }) {
  const executing = isTaskExecuting(task);
  const machine = task.machine_name || task.machine_id;
  return (
    <Link
      href={`/tasks/${task.id}`}
      className={clsx("group relative grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1.5 py-3 pr-4 pl-2 sm:grid-cols-[9rem_minmax(0,1fr)_auto]", className)}
      data-executing={executing || undefined}
    >
      {executing && <span aria-hidden className="absolute inset-y-3 left-0 w-0.5 rounded-full bg-signal" />}
      <div><TaskStatusPill task={task} /></div>
      <time className="num col-start-2 text-right text-xs text-ink-3 sm:col-start-3 sm:row-start-1" dateTime={new Date(task.updated_at).toISOString()}>
        {timeAgo(task.updated_at)}
      </time>
      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
        <div className="truncate font-medium group-hover:underline group-hover:underline-offset-2" title={task.title}>{task.title}</div>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-ink-2">
          <AgentName kind={task.agent} size={15} className="font-medium text-ink" />
          {task.model && <span className="max-w-full truncate" title={task.model}>{task.model}</span>}
          {machine && <span className="inline-flex min-w-0 max-w-full items-center gap-1" title={task.machine_id ?? undefined}>
            <Monitor aria-hidden className="size-3 shrink-0" /><span className="truncate">{machine}</span>
          </span>}
          {showProject && <span className="max-w-full truncate" title={task.project_name}>{task.project_name}</span>}
          {task.pr_number && <Chip title={task.branch ?? undefined}>
            <GitPullRequest className="size-3" aria-hidden /><span className="num">#{task.pr_number}</span>
          </Chip>}
          {(task.feedback_count ?? 1) > 1 && <Chip>{task.feedback_count} 条反馈</Chip>}
        </div>
        {task.error && <p className="mt-0.5 truncate text-xs text-bad" title={task.error}>{task.error}</p>}
      </div>
    </Link>
  );
}
