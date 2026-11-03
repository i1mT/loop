"use client";
import { ExternalLink, FileText, Pencil, RefreshCw } from "lucide-react";
import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { StatusPill } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { MarkdownEditor } from "@/components/ui/markdown-editor.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { EmptyState, ErrorState, InlineError, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import { PLAN_PHASE_LABEL } from "@/lib/status.ts";

interface Plan {
  taskId: string;
  round: number;
  revision: number;
  phase: string;
  markdown: string;
  contentHash: string;
  documentUrl: string | null;
  syncError: string | null;
  updatedAt: number;
}

export default function TaskPlanPage() {
  const { data, reload } = useTaskCtx();
  const id = data.task.id;
  const result = useApi<{ plan: Plan | null; history: Plan[]; records?: { round: number; kind: string; syncError: string | null; synced: boolean }[] }>(`/api/tasks/${id}/technical-plan`, { poll: 5000 });
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ revision: number; markdown: string } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const toast = useToast();
  const key = (plan: Plan) => `${plan.round}:${plan.revision}`;
  const latest = result.data?.plan;
  const history = result.data?.history ?? [];
  const plans = latest && !history.some((plan) => key(plan) === key(latest)) ? [latest, ...history] : history;
  const plan = plans.find((item) => key(item) === selected) ?? latest;
  async function retry() {
    setBusy(true);
    try { await apiPost(`/api/tasks/${id}/technical-plan/retry`, {}); result.reload(); reload(); toast("ok", "已经安排重新保存技术方案"); }
    catch (error) { toast("error", error instanceof ApiError ? error.message : "重新保存失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  async function revise() {
    if (!editing) return;
    setBusy(true); setEditError(null);
    try {
      await apiPost(`/api/tasks/${id}/technical-plan`, editing);
      setEditing(null); result.reload(); reload(); toast("ok", "修订已经提交，正在重新保存到飞书");
    } catch (error) { setEditError(error instanceof ApiError ? error.message : "提交修订失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  if (result.loading) return <div className="grid gap-4 pt-5" role="status" aria-label="加载技术方案"><Skeleton className="h-10" /><Skeleton className="h-64" /></div>;
  if (!result.data) return <ErrorState message={result.error?.message ?? "无法读取技术方案"} onRetry={result.reload} />;
  if (!plan) return <EmptyState icon={<FileText className="size-5" />} title="还没有技术方案">启用飞书技术方案记录后，新任务会先分析代码并保存方案。任务开始前，可以在空间设置中完成配置。</EmptyState>;
  const historical = latest && key(latest) !== key(plan);
  const canRevise = !historical && (plan.phase === "awaiting_review" || (plan.phase === "syncing" && !!plan.syncError));
  const recordErrors = (result.data.records ?? []).filter((record) => record.syncError);
  return <div className="grid gap-4 pt-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap items-center gap-2"><h2 className="text-[15px] font-semibold">技术方案</h2><StatusPill tone={plan.syncError ? "bad" : plan.phase === "awaiting_review" ? "review" : "idle"}>{plan.syncError ? "保存失败" : PLAN_PHASE_LABEL[plan.phase] ?? "正在处理"}</StatusPill></div>{plan.documentUrl && <a href={plan.documentUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1.5 text-[13px] hover:underline">在飞书中打开<ExternalLink className="size-3.5" /></a>}</div>
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-4"><div className="w-full max-w-[240px]"><Picker value={key(plan)} onChange={setSelected} ariaLabel="选择方案版本" options={plans.map((item) => ({ value: key(item), label: `第 ${item.round} 轮 · 版本 ${item.revision}${latest && key(item) === key(latest) ? "（最新）" : ""}` }))} /></div><span className="text-xs text-ink-3">更新于 {timeAgo(plan.updatedAt)}</span></div>
    {canRevise && <div className="flex flex-wrap items-center justify-between gap-3 rounded-control bg-sunken px-3 py-2.5"><p className="text-[13px] text-ink-2">需要调整方案时，可以提交修订。新版本会重新保存，需要审核的任务会等待你批准。</p><Button size="sm" onClick={() => { setEditError(null); setEditing({ revision: plan.revision, markdown: plan.markdown }); }}><Pencil className="size-3.5" />修订方案</Button></div>}
    {historical && <p className="rounded-control bg-sunken px-3 py-2 text-[13px] text-ink-2">当前查看的是历史方案，本轮执行以最新版本为准。</p>}
    {plan.syncError && <div className="grid gap-3"><InlineError>技术方案没有完整保存到飞书：{plan.syncError}</InlineError>{!historical && <div><Button size="sm" loading={busy} onClick={() => void retry()}><RefreshCw className="size-3.5" />重新保存到飞书</Button></div>}</div>}
    {recordErrors.map((record) => <div key={`${record.round}:${record.kind}`} className="grid gap-2"><InlineError>第 {record.round} 轮{record.kind === "publish" ? "发布结果" : "实际改动记录"}尚未保存到飞书：{record.syncError}</InlineError><div><Button size="sm" loading={busy} onClick={() => void retry()}>重新保存记录</Button></div></div>)}
    {result.error && <InlineError>刷新失败：{result.error.message}</InlineError>}
    {plan.markdown ? <article className="md min-w-0 break-words text-sm"><Markdown remarkPlugins={[remarkGfm]}>{plan.markdown}</Markdown></article> : <EmptyState title="正在分析任务">智能体会先阅读代码，整理背景、技术实现、改动点和验证方式。</EmptyState>}
    <Dialog open={!!editing} onOpenChange={(open) => !open && !busy && setEditing(null)} title="修订技术方案" description="保留必要章节并说明改动。提交后会生成新版本，原版本仍然可以查看。" wide>
      {editing && <div className="grid gap-4"><div className="h-[50dvh] min-h-[280px] overflow-hidden rounded-control border border-line"><MarkdownEditor id="technical-plan-revision" value={editing.markdown} onChange={(markdown) => setEditing((previous) => previous ? { ...previous, markdown } : previous)} onError={setEditError} /></div>{editError && <InlineError>{editError}</InlineError>}<div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setEditing(null)}>取消</Button><Button variant="primary" loading={busy} disabled={!editing.markdown.trim()} onClick={() => void revise()}>提交修订</Button></div></div>}
    </Dialog>
  </div>;
}
