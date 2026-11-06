"use client";
import { ExternalLink, Plus } from "lucide-react";
import Link from "next/link";
import { use, type ReactNode } from "react";
import { ProjectProvider } from "@/components/project/project-context.tsx";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { RouteTabs } from "@/components/ui/route-tabs.tsx";
import { useApi } from "@/lib/client-api.ts";
import type { MachineItem, ProjectItem, TaskItem } from "@/lib/types.ts";

/** 项目页的外壳：头部与二级导航（概览 / 任务 / 全局指令 / 设置）。每个标签是一个独立的子路由。 */
export default function ProjectLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const projects = useApi<{ projects: ProjectItem[] }>("/api/projects", { poll: 15000 });
  const archivedProjects = useApi<{ projects: ProjectItem[] }>("/api/projects?archived=1", { poll: 15000 });
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 15000 });
  const tasks = useApi<{ tasks: TaskItem[] }>("/api/tasks", { poll: 8000 });
  const project = projects.data?.projects.find((x) => x.id === id) ?? archivedProjects.data?.projects.find((x) => x.id === id);

  if(machines.error&&!machines.data)return <ErrorState message={machines.error.message} onRetry={machines.reload}/>;
  if (projects.error && !projects.data) return <ErrorState message={projects.error.message} onRetry={projects.reload} />;
  if (projects.loading || archivedProjects.loading || !machines.data)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-10 w-full max-w-md" />
        <Skeleton className="h-48" />
      </div>
    );
  if (!project)
    return (
      <Card>
        <EmptyState title="项目不存在">它可能已被删除。</EmptyState>
      </Card>
    );

  const base = `/projects/${id}`;
  return (
    <ProjectProvider
      value={{
        project,
        machines: machines.data.machines,
        tasks: (tasks.data?.tasks ?? []).filter((t) => t.project_id === id).sort((a, b) => b.updated_at - a.updated_at),
        tasksLoading: tasks.loading,
      }}
    >
      <PageHeader
        crumbs={
          <Link href="/projects" className="hover:text-ink hover:underline">
            项目
          </Link>
        }
        title={project.name}
        description={
          project.github_repo ? (
            <a href={`https://github.com/${project.github_repo}`} target="_blank" rel="noreferrer noopener" className="num inline-flex items-center gap-1 text-xs hover:underline">
              {project.github_repo}
              <ExternalLink className="size-3" aria-hidden />
            </a>
          ) : undefined
        }
        actions={
          project.archived_at ? (
            <Button variant="primary" disabled title="项目已归档，不再接收新任务">
              <Plus className="size-4" aria-hidden />
              新建任务
            </Button>
          ) : (
          <LinkButton href={`/tasks/new?project=${id}`} variant="primary">
            <Plus className="size-4" aria-hidden />
            新建任务
          </LinkButton>
          )
        }
      />
      <RouteTabs
        label="项目内容"
        tabs={[
          { href: base, label: "概览", exact: true },
          { href: `${base}/tasks`, label: "任务" },
          ...(project.canManage!==false?[{ href: `${base}/integrations`, label: "接入" }]:[]),
          { href: `${base}/instructions`, label: "全局指令" },
          { href: `${base}/settings`, label: "设置" },
        ]}
      />
      {children}
    </ProjectProvider>
  );
}
