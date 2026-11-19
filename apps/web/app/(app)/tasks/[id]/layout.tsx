"use client";
import { ChevronRight, Copy, ExternalLink, GitPullRequest, Undo2 } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { use, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { Pipeline } from "@/components/task/pipeline.tsx";
import { TaskActions } from "@/components/task/task-actions.tsx";
import { ReviewCard } from "@/components/task/review-card.tsx";
import { StatusPill } from "@/components/ui/badge.tsx";
import { ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { RouteTabs } from "@/components/ui/route-tabs.tsx";
import { TaskProvider } from "@/components/task/task-context.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { shortSha, timeAgo } from "@/lib/format.ts";
import { fold } from "@/lib/session-fold.ts";
import { canCancel, EFFORT_LABEL, hasLegacySessionTimeout, previousTaskStage, SESSION_STATE_LABEL, taskProgress } from "@/lib/status.ts";
import { useSession } from "@/lib/use-session.ts";
import type { MachineItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-baseline gap-3 text-[13px]">
      <dt className="text-ink-2">{label}</dt>
      <dd className="min-w-0 text-right [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

export default function TaskLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return <TaskWorkspace key={id} id={id}>{children}</TaskWorkspace>;
}

function TaskWorkspace({ id, children }: { id: string; children: ReactNode }) {
  const path = usePathname();
  const { data, error, loading, reload, hasMore, loadingOlder, loadOlder } = useSession(id);
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines");
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const [rewinding, setRewinding] = useState(false);
  const [rewindBusy, setRewindBusy] = useState(false);
  const folded = useMemo(() => fold(data?.events ?? []), [data?.events]);
  const diffs = folded.items.filter((i): i is Extract<typeof i, { type: "diff" }> => i.type === "diff");
  const checks = folded.items.filter((i): i is Extract<typeof i, { type: "check" }> => i.type === "check");
  const activity = useMemo(() => {
    const rows: { at: number; text: string; tone?: "bad" | "ok" }[] = [];
    for (const e of data?.events ?? []) {
      const p = e.payload as Record<string, unknown>;
      if (e.kind === "status") rows.push({ at: e.at, text: `会话${SESSION_STATE_LABEL[String(p.state)] ?? p.state}${p.detail ? `（${p.detail}）` : ""}` });
      else if (e.kind === "needs_you") rows.push({ at: e.at, text: `智能体需要你：${String(p.question).slice(0, 80)}` });
      else if (e.kind === "permission_resolved") rows.push({ at: e.at, text: `权限请求已处理（${p.optionId}）` });
      else if (e.kind === "check") rows.push({ at: e.at, text: `${{ test: "测试", preview: "预览", publish: "推送与 PR" }[String(p.name)] ?? p.name}${p.ok ? "通过" : "未通过"}`, tone: p.ok ? "ok" : "bad" });
      else if (e.kind === "error") rows.push({ at: e.at, text: `错误：${p.message}`, tone: "bad" });
    }
    for (const n of data?.notifications ?? []) rows.push({ at: n.createdAt, text: hasLegacySessionTimeout(n.body) ? "发布结果未确认。请查看线上版本。" : n.body });
    return rows.sort((a, b) => b.at - a.at);
  }, [data?.events, data?.notifications]);

  if (error && !data) return <ErrorState message={error.status === 404 ? "任务不存在，可能已被删除" : error.message} onRetry={reload} />;
  if (loading || !data)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-6 w-full max-w-md" />
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Skeleton className="h-96" />
          <Skeleton className="h-60" />
        </div>
      </div>
    );

  const base = `/tasks/${id}`;
  const { task, project } = data;
  const machineName = machines.data?.machines.find((machine) => machine.id === task.machine_id)?.name;
  const progress = taskProgress(task, data.session, !!data.leaseActive);
  if (error && progress.activity) {
    progress.activity = { label: "会话暂未同步", spinning: false };
  }
  const { info } = progress;
  const returnTo = previousTaskStage(task.stage, !!task.merge_sha, !!task.head_sha);
  const returnLabel = returnTo === "reviewing" ? "审核" : "开发";
  const rewindQueued = data.pending.some((item) => item.kind === "rewind");
  const rewindDescription = task.stage === "publishing"
    ? "当前发布结束后回到审核。已经执行的发布操作会保留。"
    : returnTo === "reviewing"
      ? (task.merge_sha ? "保留已合并的代码。回到审核后可以重试发布，也可以发消息继续改代码。" : "撤回当前发布批准，提交会重新等待审核。")
      : "保留原会话。回到开发后，发消息让智能体继续处理。";

  return (
    <TaskProvider value={{ data, progress, diffs, checks, activity, reload, hasMore, loadingOlder, loadOlder }}>
      <header className="mb-4 grid shrink-0 gap-3 sm:mb-5">
        <nav aria-label="任务位置" className="flex min-w-0 items-center gap-1.5 text-[13px] text-ink-2">
          <Link href="/" className="shrink-0 rounded-control px-1.5 py-1 -ml-1.5 hover:bg-sunken hover:text-ink">任务</Link>
          <ChevronRight className="size-3.5 shrink-0 text-ink-3" aria-hidden />
          {project && <Link href={`/projects/${project.id}`} className="truncate rounded-control px-1.5 py-1 font-medium text-ink hover:bg-sunken">{project.name}</Link>}
        </nav>
        <div className="flex items-start justify-between gap-3">
          <h1 className="min-w-0 max-w-[42ch] text-[clamp(1.5rem,2.3vw,2.1rem)] leading-[1.25] font-semibold tracking-[-0.035em] [overflow-wrap:anywhere]">{task.title}</h1>
          <TaskActions task={task} reload={reload} onCancel={canCancel(task.stage) ? () => setCancelling(true) : undefined} />
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-ink-2">
          <StatusPill tone={info.tone}>{info.label}</StatusPill>
          {task.archived_at && <span>已归档</span>}
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <AgentName kind={task.agent} size={15} />
            {machineName && <><span className="text-ink-3" aria-hidden>·</span><span className="truncate">{machineName}</span></>}
          </span>
          {task.pr_url && (
            <a href={task.pr_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 rounded-control border border-line bg-card px-2 py-0.5 font-medium text-ink hover:bg-sunken">
              <GitPullRequest className="size-3.5" aria-hidden />
              <span>PR #{task.pr_number}</span>
              <ExternalLink className="size-3 text-ink-3" aria-hidden />
            </a>
          )}
        </div>
      </header>

      <Dialog open={cancelling} onOpenChange={setCancelling} title="取消这个任务？" description="智能体会停止工作，已创建的 PR 会被关闭，工作树与分支会被清理。已合并的内容不受影响。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setCancelling(false)}>不取消</Button>
          <Button
            variant="danger"
            loading={cancelBusy}
            onClick={async () => {
              setCancelBusy(true);
              try {
                await apiPost(`/api/tasks/${id}/cancel`, {});
                mutate("/api/tasks");
                reload();
                setCancelling(false);
                toast("ok", "任务已取消");
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "取消失败");
              } finally {
                setCancelBusy(false);
              }
            }}
          >
            确认取消
          </Button>
        </div>
      </Dialog>

      <div className="mb-4 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-y border-line py-2 sm:mb-5">
        <div className="min-w-0 flex-1 basis-52">
          <Pipeline position={progress.step} tone={info.tone} />
        </div>
        {returnTo && <Button size="sm" variant="ghost" className="ml-auto" disabled={rewindQueued} onClick={() => setRewinding(true)}>
          <Undo2 className="size-3.5" aria-hidden /> {rewindQueued ? "发布结束后回退" : `回退到${returnLabel}`}
        </Button>}
      </div>

      <Dialog open={rewinding && !!returnTo} onOpenChange={setRewinding} title={`回退到${returnLabel}？`} description={rewindDescription}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRewinding(false)}>取消</Button>
          <Button variant="primary" loading={rewindBusy} onClick={async () => {
            setRewindBusy(true);
            try {
              const result = await apiPost<{ deferred: boolean }>(`/api/tasks/${id}/rewind`, { target: returnTo });
              setRewinding(false);
              mutate("/api/tasks");
              reload();
              toast("ok", result.deferred ? "发布结束后回退到审核" : `已回退到${returnLabel}`);
            } catch (e) {
              toast("error", e instanceof ApiError ? e.message : "回退失败");
            } finally {
              setRewindBusy(false);
            }
          }}>确认回退</Button>
        </div>
      </Dialog>

      {error && <div role="status" className="mb-4 flex shrink-0 items-center justify-between gap-3 rounded-control border border-warn/25 bg-warn-soft px-3 py-2 text-[13px] text-warn">
        <span>暂时无法更新任务，正在显示上次收到的信息。</span>
        <Button variant="ghost" size="sm" onClick={reload}>重新连接</Button>
      </div>}
      <div className="task-workspace grid min-w-0 gap-4 sm:gap-5">
        <div className="task-workspace-status min-w-0">
          <ReviewCard task={task} progress={progress} checks={checks} reload={reload} />
        </div>
        <section aria-label="任务内容与会话" className="task-workspace-main flex min-w-0 flex-col rounded-[14px] border border-line bg-card">
          <RouteTabs
            label="任务内容"
            variant="workspace"
            className="shrink-0"
            tabs={[
              { href: base, label: "会话", exact: true },
              { href: `${base}/feedback`, label: "反馈" },
              { href: `${base}/plan`, label: "技术方案" },
              { href: `${base}/changes`, label: "变更", count: diffs.length },
              { href: `${base}/checks`, label: "检查", count: checks.length },
              { href: `${base}/activity`, label: "活动" },
            ]}
          />
          <div key={path} className={path === base ? "flex min-h-0 min-w-0 flex-1 flex-col" : "min-h-0 min-w-0 flex-1 overflow-y-auto px-4 pb-5 sm:px-5"}>{children}</div>
        </section>

        <aside className="task-workspace-details min-w-0 border-t border-line px-1 pb-2 pt-4 sm:px-0" aria-labelledby="execution-details">
            <h2 id="execution-details" className="mb-3 text-sm font-semibold">执行详情</h2>
            <dl className="grid grid-cols-[minmax(0,1fr)] gap-2.5">
              <Fact label="仓库">{project?.github_repo ?? "—"}</Fact>
              {task.branch && <Fact label="分支">
                <Button variant="ghost" size="sm" className="h-6 max-w-full gap-1 px-0 text-xs" title={`复制分支名：${task.branch}`} onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(task.branch!);
                    toast("ok", "分支名已复制");
                  } catch {
                    toast("error", "复制失败，请手动选中分支名复制");
                  }
                }}>
                  <span className="num truncate">{task.branch}</span><Copy className="size-3 shrink-0" aria-hidden />
                </Button>
              </Fact>}
              {task.head_sha && <Fact label="提交"><span title={task.head_sha} className="num text-xs">{shortSha(task.head_sha)}</span></Fact>}
              {task.model && <Fact label="模型">{task.model}</Fact>}
              {task.effort && <Fact label="思考程度">{EFFORT_LABEL[task.effort] ?? task.effort}</Fact>}
              <Fact label="审核">{[task.plan_review ? "技术方案" : null, task.release_review ? "发布" : "自动发布"].filter(Boolean).join(" · ")}</Fact>
              <Fact label="创建于">{timeAgo(task.created_at)}</Fact>
              <Fact label="更新于">{timeAgo(task.updated_at)}</Fact>
            </dl>
        </aside>
      </div>
    </TaskProvider>
  );
}
