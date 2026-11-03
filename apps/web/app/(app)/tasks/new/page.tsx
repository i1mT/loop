"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { MarkdownEditor } from "@/components/ui/markdown-editor.tsx";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Checkbox, Select } from "@/components/ui/field.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { EFFORT_LABEL } from "@/lib/status.ts";
import { agentUsable, type MachineItem, type ProjectItem, type TaskItem } from "@/lib/types.ts";
import { AgentName, AgentSelect } from "@/components/agent/agent-icon.tsx";

/** 新建任务：整页的 Markdown 编辑器（可粘贴/拖入图片），右侧是项目、智能体与审核选项。 */
export default function NewTaskPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project: presetProject } = use(searchParams);
  const projects = useApi<{ projects: ProjectItem[] }>("/api/projects");
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines");
  const router = useRouter();
  const toast = useToast();
  const [projectId, setProjectId] = useState(presetProject ?? "");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [agentOverride, setAgentOverride] = useState("");
  const [planReview, setPlanReview] = useState(false);
  const [releaseReview, setReleaseReview] = useState(true);
  const [solo, setSolo] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const crumbs = (
    <Link href="/" className="hover:text-ink hover:underline">
      任务
    </Link>
  );
  if (projects.error && !projects.data) return <ErrorState message={projects.error.message} onRetry={projects.reload} />;
  if (projects.loading || !projects.data)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[360px]" />
      </div>
    );
  const list = projects.data.projects;
  if (list.length === 0)
    return (
      <>
        <PageHeader crumbs={crumbs} title="新建任务" />
        <Card>
          <EmptyState title="还没有项目" action={<LinkButton href="/projects" variant="primary">去创建项目</LinkButton>}>
            任务必须属于一个项目（绑定 GitHub 仓库、机器和智能体）。
          </EmptyState>
        </Card>
      </>
    );

  const chosen = list.some((p) => p.id === projectId) ? projectId : list[0].id;
  const project = list.find((p) => p.id === chosen)!;
  const machine = machines.data?.machines.find((m) => m.id === project.machine_id);
  const usableAgents = (machine?.agents ?? []).filter(agentUsable);
  /** 实际使用的智能体，及它在机器页配置的模型与思考程度 */
  const effectiveAgent = agentOverride || project.agent || "";
  const cfg = machine?.agents.find((a) => a.kind === effectiveAgent);
  const cfgText = [cfg?.defaultModel, cfg?.defaultEffort ? `思考${EFFORT_LABEL[cfg.defaultEffort] ?? cfg.defaultEffort}` : null].filter(Boolean).join(" · ") || "智能体默认";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ task: TaskItem | null; pooled: { count: number; size: number } | null }>("/api/tasks", { projectId: chosen, title: title.trim(), body, planReview, releaseReview, agent: agentOverride || undefined, mergeable: !solo });
      mutate("/api/tasks");
      if (r.task) {
        toast("ok", "任务已创建");
        router.push(`/tasks/${r.task.id}`);
      } else {
        // 小反馈先进了项目的“等待合并”池，凑够条数或手动“立即处理”后才会有任务
        toast("ok", `已进入等待合并（${r.pooled?.count ?? 1}/${r.pooled?.size ?? 3}）`);
        router.push(`/projects/${chosen}/tasks`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex h-[calc(100dvh-3rem)] min-w-0 flex-col lg:h-dvh">
      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-card px-4 py-2.5 sm:px-6">
        <Link href="/" className="inline-flex h-8 shrink-0 items-center gap-1 text-[13px] text-ink-2 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden />
          任务
        </Link>
        <input
          aria-label="标题"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="任务标题，例如：登录页的按钮文案改成“进入”"
          maxLength={200}
          autoFocus
          className="h-9 min-w-48 flex-1 basis-80 bg-transparent text-lg font-semibold text-ink outline-none placeholder:font-normal placeholder:text-ink-3"
        />
        <div className="flex shrink-0 items-center gap-2">
          {error && <span role="alert" className="text-xs text-bad">{error}</span>}
          <Button onClick={() => router.back()}>取消</Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()}>
            创建任务
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-canvas px-4 py-2 text-[13px] sm:px-6">
        <label className="flex items-center gap-2 text-ink-2">
          项目
          <Select
            aria-label="项目"
            className="h-8 w-44"
            value={chosen}
            onChange={(e) => {
              setProjectId(e.target.value);
              setAgentOverride("");
            }}
          >
            {list.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          智能体
          <AgentSelect
            ariaLabel="智能体"
            className="h-8 w-56"
            value={agentOverride}
            onChange={setAgentOverride}
            options={[
              { value: "", label: <span>沿用项目（<AgentName kind={project.agent} />）</span> },
              ...usableAgents.filter((a) => a.kind !== project.agent).map((a) => ({ value: a.kind })),
            ]}
          />
        </label>
        <span className="text-xs text-ink-3" title="在“机器”页的智能体里配置">
          {project.github_repo ?? "未设置仓库"} · {cfgText}
        </span>
        <div className="flex flex-wrap gap-x-5 gap-y-1 sm:ml-auto">
          <Checkbox checked={planReview} onChange={setPlanReview} label="先审核方案" />
          <Checkbox checked={solo} onChange={setSolo} label="单独处理，不参与合并" />
          <Checkbox checked={releaseReview} onChange={setReleaseReview} label="需要发布审核" />
        </div>
      </div>
      <div className="min-h-0 flex-1">
        <MarkdownEditor id="task-body" value={body} onChange={setBody} onError={(m) => toast("error", m)} placeholder={"## 要改什么\n\n## 怎样算做好\n\n（直接粘贴截图试试）"} />
      </div>
    </form>
  );
}
