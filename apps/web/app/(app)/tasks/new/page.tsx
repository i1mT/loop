"use client";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { MarkdownEditor } from "@/components/ui/markdown-editor.tsx";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Checkbox, Input } from "@/components/ui/field.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { Picker } from "@/components/ui/select.tsx";
import { projectHasMachine, projectBindings } from "@/lib/routing/view.ts";
import { EFFORT_LABEL } from "@/lib/status.ts";
import { agentUsable, type MachineItem, type ProjectItem, type TaskItem } from "@/lib/types.ts";
import { AgentSelect } from "@/components/agent/agent-icon.tsx";

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
  if(machines.error&&!machines.data)return <ErrorState message={machines.error.message} onRetry={machines.reload}/>;
  if (projects.error && !projects.data) return <ErrorState message={projects.error.message} onRetry={projects.reload} />;
  if (projects.loading || !projects.data || (machines.loading&&!machines.data))
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
  const candidates=(machines.data?.machines??[]).filter(machine=>projectHasMachine(project,machine.id));
  const bindings=projectBindings(project);
  const usableAgents=[...new Map(candidates.flatMap(machine=>machine.agents.filter(agentUsable)).map(agent=>[agent.kind,agent])).values()];
  /** 不指定智能体时，每台机器用自己的绑定配置；指定后只找安装了该智能体的机器。 */
  const compatible=candidates.filter(machine=>bindings.some(binding=>binding.machineId===machine.id&&machine.agents.some(agent=>agent.kind===(agentOverride||binding.agent)&&agentUsable(agent))));
  const overrideCfg = agentOverride ? compatible[0]?.agents.find((a) => a.kind === agentOverride) : undefined;
  const bindingConfigs=bindings.map(binding=>{
    const machine=candidates.find(item=>item.id===binding.machineId);
    const cfg=machine?.agents.find(a=>a.kind===binding.agent);
    return {kind:binding.agent,model:binding.model||cfg?.defaultModel,effort:binding.effort||cfg?.defaultEffort};
  });
  const distinctConfigs=new Set(bindingConfigs.map(cfg=>`${cfg.kind}|${cfg.model??""}|${cfg.effort??""}`));
  const summary = agentOverride
    ? (!compatible.length ? "当前没有准备好此智能体的机器" : compatible.length>1 ? `${compatible.length} 台候选机器 · 使用分配机器的配置` : [overrideCfg?.defaultModel, overrideCfg?.defaultEffort ? `思考${EFFORT_LABEL[overrideCfg.defaultEffort] ?? overrideCfg.defaultEffort}` : null].filter(Boolean).join(" · ") || "智能体默认")
    : !distinctConfigs.size ? "项目还没有可用的机器配置" : distinctConfigs.size===1 ? [bindingConfigs[0]?.model, bindingConfigs[0]?.effort ? `思考${EFFORT_LABEL[bindingConfigs[0].effort] ?? bindingConfigs[0].effort}` : null].filter(Boolean).join(" · ") || "智能体默认" : `${bindings.length} 台机器 · 各用自己配置的智能体`;

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
        <Input
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
          <Button type="submit" variant="primary" loading={busy} disabled={!title.trim()||!compatible.length}>
            创建任务
          </Button>
        </div>
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-2 border-b border-line bg-canvas px-4 py-2 text-[13px] sm:px-6">
        <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          项目
          <Picker ariaLabel="项目" className="w-44" value={chosen} onChange={value=>{setProjectId(value);setAgentOverride("");}} options={list.map(project=>({value:project.id,label:project.name}))}/>

        </label>
        <label className="flex items-center gap-2 whitespace-nowrap text-ink-2">
          智能体
          <AgentSelect
            ariaLabel="智能体"
            className="h-8 w-56"
            value={agentOverride}
            onChange={setAgentOverride}
            options={[
              { value: "", label: <span>按项目设置（每台机器各自的智能体）</span> },
              ...usableAgents.map((a) => ({ value: a.kind })),
            ]}
          />
        </label>
        <span className="text-xs text-ink-3" title="模型与思考程度在项目设置或机器页配置">
          {project.github_repo ?? "未设置仓库"} · {summary}
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
