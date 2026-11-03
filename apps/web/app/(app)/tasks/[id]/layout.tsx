"use client";
import { Copy, ExternalLink, GitBranch, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { use, useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { ApiError, apiPost, mutate } from "@/lib/client-api.ts";
import { Pipeline } from "@/components/task/pipeline.tsx";
import { TaskActions } from "@/components/task/task-actions.tsx";
import { ReviewCard } from "@/components/task/review-card.tsx";
import { Chip, StatusPill } from "@/components/ui/badge.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { RouteTabs } from "@/components/ui/route-tabs.tsx";
import { TaskProvider } from "@/components/task/task-context.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { shortSha, timeAgo } from "@/lib/format.ts";
import { fold } from "@/lib/session-fold.ts";
import { canCancel, EFFORT_LABEL, isFinished, SESSION_STATE_LABEL, stageInfo } from "@/lib/status.ts";
import { useSession } from "@/lib/use-session.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 text-[13px]">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="min-w-0 truncate text-right">{children}</dd>
    </div>
  );
}

export default function TaskLayout({ children, params }: { children: ReactNode; params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, loading, reload } = useSession(id);
  const toast = useToast();
  const [cancelling, setCancelling] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
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
    for (const n of data?.notifications ?? []) rows.push({ at: n.createdAt, text: n.body });
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
  const info = stageInfo(task.stage);
  const closed = isFinished(task.stage);

  return (
    <TaskProvider value={{ data, diffs, checks, activity, reload }}>
      <PageHeader
        crumbs={
          <>
            <Link href="/" className="hover:text-ink hover:underline">
              任务
            </Link>
            <span className="mx-1.5 text-ink-3">/</span>
            {project ? (
              <Link href={`/projects/${project.id}`} className="hover:text-ink hover:underline">
                {project.name}
              </Link>
            ) : (
              "…"
            )}
          </>
        }
        title={task.title}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <TaskActions task={task} reload={reload} />
            {canCancel(task.stage) && (
              <Button variant="ghost" onClick={() => setCancelling(true)}>
                取消任务
              </Button>
            )}
          </div>
        }
        description={
          <span className="flex flex-wrap items-center gap-2">
            <StatusPill tone={info.tone} pulse>
              {info.label}
            </StatusPill>
            <span className="text-[13px]">{info.hint}</span>
          </span>
        }
      />

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

      {task.archived_at && <p className="mb-4 rounded-control bg-sunken px-3 py-2 text-[13px] text-ink-2">这个任务已归档，不在默认列表里显示。点“恢复”可以放回去。</p>}
      <div className="mb-5 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Chip>
          <AgentName kind={task.agent} size={14} />
          {task.machine_id ? ` @ ${task.machine_id}` : ""}
        </Chip>
        {(task.model || task.effort) && (
          <Chip title="创建任务时确定的模型与思考程度">
            {[task.model, task.effort ? `思考${EFFORT_LABEL[task.effort] ?? task.effort}` : null].filter(Boolean).join(" · ")}
          </Chip>
        )}
        {task.branch && (
          <button
            className="cursor-pointer"
            title="复制分支名"
            onClick={() => {
              void navigator.clipboard?.writeText(task.branch!);
              toast("ok", "分支名已复制");
            }}
          >
            <Chip className="hover:bg-sunken">
              <GitBranch className="size-3" aria-hidden />
              <span className="num max-w-[260px] truncate">{task.branch}</span>
              <Copy className="size-3 text-ink-3" aria-hidden />
            </Chip>
          </button>
        )}
        {task.pr_url && (
          <a href={task.pr_url} target="_blank" rel="noreferrer noopener">
            <Chip className="hover:bg-sunken">
              <GitPullRequest className="size-3" aria-hidden />
              <span className="num">PR #{task.pr_number}</span>
              <ExternalLink className="size-3 text-ink-3" aria-hidden />
            </Chip>
          </a>
        )}
        <span className="num text-xs text-ink-3">创建于 {timeAgo(task.created_at)}</span>
      </div>

      <Card className="mb-6 px-5 py-4">
        <Pipeline stage={task.stage} attention={info.tone === "review" || info.tone === "warn"} />
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <Card className="min-w-0 px-4 pb-4 pt-1">
          <RouteTabs
            label="任务内容"
            className="mb-0"
            tabs={[
              { href: base, label: "会话", exact: true },
              { href: `${base}/feedback`, label: "反馈" },
              { href: `${base}/plan`, label: "技术方案" },
              { href: `${base}/changes`, label: "变更", count: diffs.length },
              { href: `${base}/checks`, label: "检查", count: checks.length },
              { href: `${base}/activity`, label: "活动" },
            ]}
          />
          {children}
        </Card>

        <aside className="grid gap-4 lg:sticky lg:top-6">
          <ReviewCard task={task} checks={checks} reload={reload} />
          <Card className="p-4">
            <h2 className="mb-3 text-[15px] font-semibold">详情</h2>
            <dl className="grid gap-2">
              <Fact label="项目">{project?.name ?? "…"}</Fact>
              <Fact label="仓库">
                <span className="num">{project?.github_repo ?? "—"}</span>
              </Fact>
              <Fact label="提交">
                <span className="num">{shortSha(task.head_sha)}</span>
              </Fact>
              <Fact label="方案审核">{task.plan_review ? "需要" : "不需要"}</Fact>
              <Fact label="发布审核">{task.release_review ? "需要" : "自动发布"}</Fact>
              <Fact label="会话">{data.session ? (SESSION_STATE_LABEL[data.session.state] ?? data.session.state) : "未开始"}</Fact>
              <Fact label="更新于">{timeAgo(task.updated_at)}</Fact>
            </dl>
            {closed && task.error && <p className="mt-3 break-words border-t border-line pt-3 text-xs text-ink-2">{task.error}</p>}
          </Card>
        </aside>
      </div>
    </TaskProvider>
  );
}
