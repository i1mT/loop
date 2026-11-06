"use client";
import { MachineSummary } from "@/components/project/machine-summary.tsx";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { TaskRows } from "@/components/project/task-rows.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { GROUP_LABEL, GROUP_ORDER, stageInfo, type Group } from "@/lib/status.ts";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-ink-2">{label}</dt>
      <dd className="mt-0.5 break-all text-sm">{children}</dd>
    </div>
  );
}

/** 概览：这个项目现在在用什么、任务进度如何。不放表单。 */
export default function ProjectOverview() {
  const { project: p, machines, tasks, tasksLoading } = useProjectCtx();
  const counts: Partial<Record<Group, number>> = {};
  for (const t of tasks) counts[stageInfo(t.stage).group] = (counts[stageInfo(t.stage).group] ?? 0) + 1;

  return (
    <>
      <Card className="mb-6 p-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <Fact label="主分支">
            <span className="num inline-flex items-center gap-1">
              <GitBranch className="size-3.5 text-ink-2" aria-hidden />
              {p.main_ref}
            </span>
          </Fact>
          <Fact label="执行机器、智能体与分配顺序"><MachineSummary project={p} machines={machines} detailed/></Fact>
        </dl>

      </Card>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        {GROUP_ORDER.map((g) => (
          <Card key={g} className="px-4 py-3">
            <div className="num text-[22px] font-semibold leading-8">{counts[g] ?? 0}</div>
            <div className="text-xs text-ink-2">{GROUP_LABEL[g]}</div>
          </Card>
        ))}
      </div>

      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">最近的任务</h2>
        <Link href={`/projects/${p.id}/tasks`} className="text-[13px] text-ink-2 hover:text-ink hover:underline">
          查看全部
        </Link>
      </div>
      <TaskRows tasks={tasks.slice(0, 5)} loading={tasksLoading} emptyHint="新建一个任务，智能体会在独立分支上完成并提交 PR。" />
    </>
  );
}
