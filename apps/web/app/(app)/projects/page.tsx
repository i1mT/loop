"use client";
import { MachineSummary } from "@/components/project/machine-summary.tsx";
import { Archive, FolderGit2, Plus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { NewProjectDialog } from "@/components/new-project-dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/ui/states.tsx";
import { useApi } from "@/lib/client-api.ts";
import { stageInfo } from "@/lib/status.ts";
import { timeAgo } from "@/lib/format.ts";
import type { MachineItem, ProjectItem, TaskItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";
import { bindingAgents, projectBindings } from "@/lib/routing/view.ts";

export default function ProjectsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const projects = useApi<{ projects: ProjectItem[] }>(showArchived ? "/api/projects?archived=1" : "/api/projects", { poll: 15000 });
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 15000 });
  const tasks = useApi<{ tasks: TaskItem[] }>("/api/tasks", { poll: 15000 });
  const [creating, setCreating] = useState(false);
  const list = projects.data?.projects ?? [];

  return (
    <>
      <PageHeader
        title="项目"
        description="为项目配置仓库和多台执行机器，任务优先分配给在线空闲机器。"
        actions={
          <div className="flex items-center gap-2">
            <Button aria-pressed={showArchived} variant={showArchived ? "primary" : "secondary"} onClick={() => setShowArchived(!showArchived)}>
              <Archive className="size-4" aria-hidden />
              已归档
            </Button>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4" aria-hidden />
              新建项目
            </Button>
          </div>
        }
      />
      <NewProjectDialog open={creating} onOpenChange={setCreating} />
      <Card className="overflow-hidden">
        {projects.loading ? (
          <RowsSkeleton rows={4} />
        ) : projects.error && !projects.data ? (
          <ErrorState message={projects.error.message} onRetry={projects.reload} />
        ) : list.length === 0 && showArchived ? (
          <EmptyState icon={<Archive className="size-5" aria-hidden />} title="没有已归档的项目">在项目的“设置”里可以归档项目，归档后不再接收新任务，随时可恢复。</EmptyState>
        ) : list.length === 0 ? (
          <EmptyState
            icon={<FolderGit2 className="size-5" aria-hidden />}
            title="还没有项目"
            action={
              <Button variant="primary" onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                新建第一个项目
              </Button>
            }
          >
            创建项目时选择 GitHub 仓库和执行任务的机器、智能体。
          </EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((p) => {
              const bindings = projectBindings(p);
              const online = bindings.some((b) => machines.data?.machines.find((x) => x.id === b.machineId)?.online);
              const agents = bindingAgents(bindings);
              const mine = (tasks.data?.tasks ?? []).filter((t) => t.project_id === p.id);
              const open = mine.filter((t) => ["attention", "review"].includes(stageInfo(t.stage).group)).length;
              const last = mine.reduce((a, t) => Math.max(a, t.updated_at), 0);
              return (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="group flex flex-wrap items-center gap-x-6 gap-y-1 px-4 py-3.5 transition-colors hover:bg-canvas/60">
                    <div className="min-w-0 flex-1 basis-56">
                      <div className="truncate font-medium group-hover:underline group-hover:underline-offset-2">{p.name}</div>
                      <div className="num mt-0.5 truncate text-xs text-ink-2">{p.github_repo ?? "未设置仓库"}</div>
                    </div>
                    <div className="flex items-center gap-2 text-[13px] text-ink-2">
                      <span className={`size-2 rounded-full ${online ? "bg-ok" : "bg-ink-3"}`} aria-hidden />
                      <MachineSummary project={p} machines={machines.data?.machines??[]}/>
                      <span className="inline-flex items-center gap-1">{agents.map((kind) => <AgentName key={kind} kind={kind} size={14} />)}</span>
                      <span className="sr-only">{online ? "（有机器在线）" : "（机器都离线）"}</span>
                    </div>
                    <div className="num w-44 text-right text-xs text-ink-3">
                      {mine.length} 个任务{open > 0 && <span className="text-signal"> · {open} 个待处理</span>}
                      {last > 0 && <div>{timeAgo(last)}</div>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </>
  );
}
