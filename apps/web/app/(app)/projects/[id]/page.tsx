"use client";
import Link from "next/link";
import { GitBranch } from "lucide-react";
import { TaskRows } from "@/components/project/task-rows.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EFFORT_LABEL, GROUP_LABEL, GROUP_ORDER, stageInfo, type Group } from "@/lib/status.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

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
  const m = machines.find((x) => x.id === p.machine_id);
  const a = m?.agents.find((x) => x.kind === p.agent);
  const cfg = [a?.defaultModel, a?.defaultEffort ? `思考${EFFORT_LABEL[a.defaultEffort] ?? a.defaultEffort}` : null].filter(Boolean).join(" · ");
  const counts: Partial<Record<Group, number>> = {};
  for (const t of tasks) counts[stageInfo(t.stage).group] = (counts[stageInfo(t.stage).group] ?? 0) + 1;

  return (
    <>
      <Card className="mb-6 p-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Fact label="主分支">
            <span className="num inline-flex items-center gap-1">
              <GitBranch className="size-3.5 text-ink-2" aria-hidden />
              {p.main_ref}
            </span>
          </Fact>
          <Fact label="机器">
            <Link href={`/machines/${p.machine_id}`} className="inline-flex items-center gap-1.5 hover:underline">
              <span className={`size-2 rounded-full ${m?.online ? "bg-ok" : "bg-ink-3"}`} aria-hidden />
              {m?.name ?? p.machine_id}
              <span className="text-xs text-ink-2">{m ? (m.online ? "在线" : "离线") : ""}</span>
            </Link>
          </Fact>
          <Fact label="智能体">
            <Link href={`/machines/${p.machine_id}/agents/${p.agent}`} className="hover:underline">
              <AgentName kind={p.agent} />
            </Link>
          </Fact>
          <Fact label="模型与思考程度">
            <span className="text-ink-2">{cfg || "智能体默认"}</span>
            <span className="block text-xs text-ink-3">在机器页的智能体里配置</span>
          </Fact>
        </dl>
        {p.local_path && <p className="num mt-4 border-t border-line pt-3 text-xs text-ink-2">已有检出：{p.local_path}</p>}
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
