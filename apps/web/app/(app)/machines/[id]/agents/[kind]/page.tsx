"use client";
import { projectBindings, projectHasMachine } from "@/lib/routing/view.ts";
import { RefreshCw } from "lucide-react";
import Link from "next/link";
import { use, useEffect, useState } from "react";
import { useModelRefresh } from "@/components/agent/use-model-refresh.ts";
import { StatusPill } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/states.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, mutate, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import { EFFORTS, EFFORT_LABEL } from "@/lib/status.ts";
import type { MachineItem, ProjectItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

/** 某台机器上某个智能体的默认模型与思考程度；项目设置里可以按机器覆盖。 */
export default function AgentPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = use(params);
  const toast = useToast();
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 15000 });
  const projects = useApi<{ projects: ProjectItem[] }>("/api/projects");
  const machine = machines.data?.machines.find((m) => m.id === id);
  const agent = machine?.agents.find((a) => a.kind === kind);
  const [model, setModel] = useState("");
  const [effort, setEffort] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setModel(agent?.defaultModel ?? "");
    setEffort(agent?.defaultEffort ?? "");
  }, [agent?.defaultModel, agent?.defaultEffort]);
  const refresh = useModelRefresh(id, kind, agent?.modelsAt ?? null, agent?.probePending ?? false, agent?.probeError ?? null);
  const label = <AgentName kind={kind} size={22} />;
  const dirty = (agent?.defaultModel ?? "") !== model || (agent?.defaultEffort ?? "") !== effort;
  const using = (projects.data?.projects ?? []).filter((p) => projectHasMachine(p,id) && projectBindings(p).some(binding=>binding.machineId===id&&binding.agent===kind));
  const usable = !!agent && agent.installed && agent.acp;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/machines/${id}/agents/${kind}`, { model: model.trim() || null, effort: effort || null });
      mutate("/api/machines");
      toast("ok", "已保存，之后创建的任务使用这个配置");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (machines.error && !machines.data) return <ErrorState message={machines.error.message} onRetry={machines.reload} />;
  if (machines.loading)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-64" />
      </div>
    );
  if (!machine || !agent)
    return (
      <Card>
        <EmptyState title="没有找到这个智能体">这台机器上没有上报过 {label}。</EmptyState>
      </Card>
    );

  return (
    <>
      <PageHeader
        crumbs={
          <>
            <Link href="/machines" className="hover:text-ink hover:underline">
              机器
            </Link>
            <span className="mx-1.5 text-ink-3">/</span>
            <Link href={`/machines/${id}`} className="hover:text-ink hover:underline">
              {machine.name}
            </Link>
          </>
        }
        title={label}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={usable ? "ok" : "idle"}>{usable ? "可用" : agent.note ?? "不可用"}</StatusPill>
            {agent.version && <span className="num text-xs">{agent.version}</span>}
          </span>
        }
      />

      <Card className="mb-6">
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">模型与思考程度</h2>
        {!machine.owned ? (
          <div className="p-4 text-sm text-ink-2"><p>此智能体由机器所有者配置。</p><p className="mt-2">模型：{agent.defaultModel || "智能体默认"} · 思考程度：{agent.defaultEffort || "智能体默认"}</p></div>
        ) : !usable ? (
          <EmptyState title="这个智能体当前不可用">{agent.note ?? "未安装或暂不能被驱动。"}</EmptyState>
        ) : (
          <form onSubmit={save} className="grid gap-5 p-4 sm:max-w-2xl">
            <p className="text-[13px] text-ink-2">这是 {machine.name} 上 {label} 的默认配置：由它执行的任务，创建时会记录当时的模型与思考程度。已创建的任务不受影响。留空表示使用智能体自己的默认。</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="模型"
                action={
                  <Button size="sm" variant="ghost" className="-my-1.5" type="button" onClick={refresh.start} disabled={refresh.waiting || !machine.online} title={machine.online ? "让这台机器重新读取该智能体可选的模型与思考程度" : "机器离线，无法刷新"}>
                    <RefreshCw className={`size-3.5 ${refresh.waiting ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden />
                    刷新模型列表
                  </Button>
                }
                hint={
                  refresh.error ? (
                    <span className="text-bad">{refresh.error}</span>
                  ) : refresh.waiting ? (
                    "正在向机器请求最新模型列表，通常几十秒内完成…"
                  ) : agent.models.length ? (
                    agent.modelsAt ? `共 ${agent.models.length} 个模型，更新于 ${timeAgo(agent.modelsAt)}` : undefined
                  ) : (
                    "还没有模型列表，点右上角刷新，或手动输入模型 ID"
                  )
                }
              >
                {(fid) =>
                  agent.models.length ? (
                    <Picker ariaLabel="模型" value={model || "__default"} onChange={value=>setModel(value === "__default" ? "" : value)} options={[
                      {value:"__default",label:"智能体默认"},
                      ...(model && !agent.models.some(option=>option.value===model) ? [{value:model,label:`${model}（已不在列表中）`}] : []),
                      ...agent.models.map(option=>({value:option.value,label:option.name})),
                    ]} />
                  ) : (
                    <Input id={fid} value={model} onChange={(e) => setModel(e.target.value)} placeholder="留空使用默认" spellCheck={false} />
                  )
                }
              </Field>
              <Field label="思考程度" hint="某个模型不支持的程度会被忽略，并记入任务活动">
                {(fid) => (
                  <Picker ariaLabel="思考程度" value={effort || "__default"} onChange={value=>setEffort(value === "__default" ? "" : value)} options={[
                    {value:"__default",label:"智能体默认"},
                    ...(agent.efforts.length ? agent.efforts.map(option=>option.value) : [...EFFORTS]).map(value=>({value,label:`${EFFORT_LABEL[value] ?? value}（${value}）`})),
                    ...(effort && !agent.efforts.some(option=>option.value===effort) && !(EFFORTS as readonly string[]).includes(effort) ? [{value:effort,label:`${effort}（已不在列表中）`}] : []),
                  ]} />
                )}
              </Field>
            </div>
            {error && <InlineError>{error}</InlineError>}
            <div className="flex items-center gap-3">
              <Button type="submit" variant="primary" loading={busy} disabled={!dirty}>
                保存
              </Button>
              {dirty && <span className="text-xs text-ink-2">有未保存的修改</span>}
            </div>
          </form>
        )}
      </Card>

      <h2 className="mb-2 text-[15px] font-semibold">使用这个智能体的项目</h2>
      <Card className="overflow-hidden">
        {using.length === 0 ? (
          <EmptyState title="还没有项目使用它">在项目的“设置”里选择机器和智能体。</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {using.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="block px-4 py-3 text-sm hover:bg-canvas/60">
                  {p.name} <span className="num text-xs text-ink-2">{p.github_repo}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
