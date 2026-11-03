"use client";
import clsx from "clsx";
import { Archive, ArchiveRestore, GitPullRequest, ListChecks, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Chip, StatusPill } from "@/components/ui/badge.tsx";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Input, Select } from "@/components/ui/field.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, RowsSkeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import { canArchive, GROUP_LABEL, GROUP_ORDER, stageInfo, type Group } from "@/lib/status.ts";
import type { GlobalPool, TaskItem } from "@/lib/types.ts";
import { PoolPanel } from "@/components/project/pool-panel.tsx";
import { AgentName } from "@/components/agent/agent-icon.tsx";

/** pool：等待合并的小反馈（还不是任务），与任务列表互斥显示 */
type Filter = "all" | Group | "pool";


export default function TasksPage() {
  const toast = useToast();
  const [archivedView, setArchivedView] = useState(false);
  const { data, error, loading, reload } = useApi<{ tasks: TaskItem[] }>(archivedView ? "/api/tasks?archived=1" : "/api/tasks", { poll: 5000 });
  const pool = useApi<{ pool: GlobalPool }>("/api/pool", { poll: 5000 });
  const [filter, setFilter] = useState<Filter>("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [project, setProject] = useState("");

  const tasks = data?.tasks ?? [];
  const projects = useMemo(() => [...new Map(tasks.map((t) => [t.project_id, t.project_name])).entries()], [tasks]);
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tasks.length };
    for (const t of tasks) c[stageInfo(t.stage).group] = (c[stageInfo(t.stage).group] ?? 0) + 1;
    return c;
  }, [tasks]);
  const shown = tasks.filter((t) => {
    if (filter !== "all" && filter !== "pool" && stageInfo(t.stage).group !== filter) return false;
    if (project && t.project_id !== project) return false;
    if (query && !`${t.title} ${t.project_name} ${t.branch ?? ""}`.toLowerCase().includes(query.toLowerCase())) return false;
    return true;
  });

  const poolItems = (pool.data?.pool.items ?? []).filter((f) => (!project || f.project_id === project) && (!query || `${f.title} ${f.project_name}`.toLowerCase().includes(query.toLowerCase())));
  const poolCount = pool.data?.pool.items.length ?? 0;
  const onPool = filter === "pool" && !archivedView;

  const pickable = shown.filter((t) => archivedView || canArchive(t.stage));
  const pickedHere = pickable.filter((t) => picked.has(t.id));
  async function batchArchive(archived: boolean) {
    setBatchBusy(true);
    try {
      const results = await Promise.allSettled(pickedHere.map((t) => apiPost(`/api/tasks/${t.id}/archive`, { archived })));
      const bad = results.filter((r) => r.status === "rejected").length;
      toast(bad ? "error" : "ok", bad ? `${bad} 个任务操作失败` : archived ? `已归档 ${pickedHere.length} 个任务` : `已恢复 ${pickedHere.length} 个任务`);
      setPicked(new Set());
      mutate("/api/tasks");
      reload();
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBatchBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="任务"
        description="每个任务在独立分支上完成，通过 PR 合并。需要你处理的排在最前。"
        actions={
          <LinkButton href="/tasks/new" variant="primary">
            <Plus className="size-4" aria-hidden />
            新建任务
          </LinkButton>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div role="tablist" aria-label="按状态筛选" className="flex flex-wrap gap-1">
          {(["all", ...GROUP_ORDER] as ("all" | Group)[]).map((g) => {
            const n = counts[g] ?? 0;
            const on = filter === g && !onPool;
            return (
              <button
                key={g}
                role="tab"
                aria-selected={on}
                onClick={() => setFilter(g)}
                className={clsx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-[13px] transition-colors", on ? "bg-ink text-card" : "text-ink-2 hover:bg-sunken hover:text-ink")}
              >
                {g === "all" ? "全部" : GROUP_LABEL[g]}
                <span className={clsx("num text-[11px]", on ? "text-card/70" : "text-ink-3")}>{n}</span>
              </button>
            );
          })}
          {!archivedView && (
            <button
              role="tab"
              aria-selected={onPool}
              onClick={() => setFilter("pool")}
              className={clsx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-[13px] transition-colors", onPool ? "bg-ink text-card" : "text-ink-2 hover:bg-sunken hover:text-ink")}
            >
              等待合并
              <span className={clsx("num text-[11px]", onPool ? "text-card/70" : "text-ink-3")}>{poolCount}</span>
            </button>
          )}
          <button
            role="tab"
            aria-selected={archivedView}
            onClick={() => {
              setArchivedView(!archivedView);
              setFilter("all");
              setPicked(new Set());
            }}
            className={clsx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control px-2.5 text-[13px] transition-colors", archivedView ? "bg-ink text-card" : "text-ink-2 hover:bg-sunken hover:text-ink")}
          >
            <Archive className="size-3.5" aria-hidden />
            已归档
          </button>
        </div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">
          {projects.length > 1 && (
            <div className="w-40">
              <Select aria-label="按项目筛选" value={project} onChange={(e) => setProject(e.target.value)}>
                <option value="">全部项目</option>
                {projects.map(([id, name]) => (
                  <option key={id} value={id}>
                    {name}
                  </option>
                ))}
              </Select>
            </div>
          )}
          <div className="relative w-52">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
            <Input aria-label="搜索任务" className="pl-8" placeholder="搜索标题、项目、分支" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
        </div>
      </div>

      {pickedHere.length > 0 && (
        <div className="mb-3 flex items-center gap-3 rounded-control border border-line bg-card px-3 py-2 text-[13px]">
          <span>已选 {pickedHere.length} 个</span>
          <Button loading={batchBusy} onClick={() => batchArchive(!archivedView)}>
            {archivedView ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
            {archivedView ? "恢复所选" : "归档所选"}
          </Button>
          <Button variant="ghost" onClick={() => setPicked(new Set())}>
            清除选择
          </Button>
        </div>
      )}

      <Card className="overflow-hidden">
        {onPool ? (
          pool.loading ? (
            <RowsSkeleton rows={3} />
          ) : pool.error && !pool.data ? (
            <ErrorState message={pool.error.message} onRetry={pool.reload} />
          ) : (
            <PoolPanel pool={pool.data!.pool} items={poolItems} />
          )
        ) : loading ? (
          <RowsSkeleton />
        ) : error && !data ? (
          <ErrorState message={error.message} onRetry={reload} />
        ) : tasks.length === 0 && archivedView ? (
          <EmptyState icon={<Archive className="size-5" aria-hidden />} title="没有已归档的任务">已结束的任务可以在详情页或这里批量归档，归档后从默认列表隐藏，随时可恢复。</EmptyState>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={<ListChecks className="size-5" aria-hidden />}
            title="还没有任务"
            action={
              <LinkButton href="/tasks/new" variant="primary">
                <Plus className="size-4" aria-hidden />
                新建第一个任务
              </LinkButton>
            }
          >
            先在“项目”里绑定一个 GitHub 仓库、机器和智能体，再来创建任务。
          </EmptyState>
        ) : shown.length === 0 ? (
          <EmptyState title="没有匹配的任务">换一个状态或清空搜索条件试试。</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {shown
              .slice()
              .sort((a, b) => GROUP_ORDER.indexOf(stageInfo(a.stage).group) - GROUP_ORDER.indexOf(stageInfo(b.stage).group) || b.updated_at - a.updated_at)
              .map((t) => {
                const info = stageInfo(t.stage);
                return (
                  <li key={t.id} className="flex items-center hover:bg-canvas/60">
                    <label className="flex w-10 shrink-0 cursor-pointer items-center justify-center self-stretch">
                      <input
                        type="checkbox"
                        aria-label={`选择：${t.title}`}
                        disabled={!archivedView && !canArchive(t.stage)}
                        title={archivedView || canArchive(t.stage) ? undefined : "只有已结束的任务可以归档"}
                        checked={picked.has(t.id)}
                        onChange={(e) =>
                          setPicked((s) => {
                            const n = new Set(s);
                            if (e.target.checked) n.add(t.id);
                            else n.delete(t.id);
                            return n;
                          })
                        }
                        className="size-4 cursor-pointer accent-ink disabled:cursor-not-allowed disabled:opacity-30"
                      />
                    </label>
                    <Link href={`/tasks/${t.id}`} className="group grid min-w-0 flex-1 grid-cols-[1fr_auto] items-center gap-x-4 gap-y-1.5 py-3 pr-4 transition-colors sm:grid-cols-[88px_minmax(0,1fr)_84px]">
                      <div>
                        <StatusPill tone={info.tone} pulse>
                          {info.label}
                        </StatusPill>
                      </div>
                      <time className="num col-start-2 text-right text-xs text-ink-3 sm:col-start-3 sm:row-start-1" dateTime={new Date(t.updated_at).toISOString()}>
                        {timeAgo(t.updated_at)}
                      </time>
                      <div className="col-span-2 min-w-0 sm:col-span-1 sm:col-start-2 sm:row-start-1">
                        <div className="truncate font-medium group-hover:underline group-hover:underline-offset-2">{t.title}</div>
                        <div className="mt-0.5 flex min-w-0 items-center gap-2 text-xs text-ink-2">
                          <span className="truncate">
                            {t.project_name} · <AgentName kind={t.agent} size={14} />
                            {t.machine_id ? ` @ ${t.machine_id}` : ""}
                            {t.error && <span className="text-bad"> · {t.error}</span>}
                          </span>
                          {t.pr_number && (
                            <Chip title={t.branch ?? undefined} className="shrink-0">
                              <GitPullRequest className="size-3" aria-hidden />
                              <span className="num">#{t.pr_number}</span>
                            </Chip>
                          )}
                        </div>
                      </div>
                    </Link>
                  </li>
                );
              })}
          </ul>
        )}
      </Card>
      {error && data && <p className="mt-2 text-xs text-bad">刷新失败（{error.message}），正在显示上次的数据。</p>}
    </>
  );
}
