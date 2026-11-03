"use client";
import { AlertTriangle, CheckCircle2, ExternalLink, GitMerge, GitPullRequest, Hourglass, XCircle } from "lucide-react";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Textarea } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { shortSha } from "@/lib/format.ts";
import { canRestore, stageInfo } from "@/lib/status.ts";
import type { Item } from "@/lib/session-fold.ts";
import type { TaskItem } from "@/lib/types.ts";

export function ReviewCard({ task, checks, reload }: { task: TaskItem; checks: Extract<Item, { type: "check" }>[]; reload: () => void }) {
  const toast = useToast();
  const technicalPlan = useApi<{ plan: { round: number; revision: number } | null }>(task.stage === "plan_reviewing" ? `/api/tasks/${task.id}/technical-plan` : null);
  const [busy, setBusy] = useState<"approve" | "reject" | "republish" | "restore" | null>(null);
  const [rejecting, setRejecting] = useState<null | "plan" | "review">(null);
  const [reason, setReason] = useState("");
  const latest = (name: string) => [...checks].reverse().find((c) => c.name === name);
  const test = latest("test");
  const preview = latest("preview");
  const publish = latest("publish");

  const [marking, setMarking] = useState<null | "published" | "failed">(null);
  const [note, setNote] = useState("");
  async function override(to: "published" | "failed") {
    setBusy(to === "published" ? "approve" : "reject");
    try {
      await apiPost(`/api/tasks/${task.id}/outcome`, { to, note: note || undefined });
      mutate("/api/tasks");
      reload();
      toast("ok", to === "published" ? "已标记为已发布" : "已标记为失败");
      setMarking(null);
      setNote("");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function republish() {
    setBusy("republish");
    try {
      await apiPost(`/api/tasks/${task.id}/republish`);
      reload();
      toast("ok", "已请求守护进程重新推送并创建 PR，片刻后刷新");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    setBusy("restore");
    try {
      await apiPost(`/api/tasks/${task.id}/restore`);
      mutate("/api/tasks");
      reload();
      toast("ok", "已恢复到待审核，守护进程会重建工作树并重新创建 PR");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "恢复失败");
    } finally {
      setBusy(null);
    }
  }

  async function confirmPublish(ok: boolean) {
    setBusy(ok ? "approve" : "reject");
    try {
      await apiPost(`/api/tasks/${task.id}/publish-confirm`, { ok });
      mutate("/api/tasks");
      reload();
      toast("ok", ok ? "已确认发布成功" : "已标记发布失败");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  async function decide(kind: "plan" | "review", decision: "approve" | "reject", why?: string) {
    setBusy(decision);
    try {
      await apiPost(`/api/tasks/${task.id}/${kind}`, { decision, reason: why || undefined, revision: kind === "plan" ? technicalPlan.data?.plan?.revision : undefined });
      mutate("/api/tasks");
      reload();
      toast("ok", decision === "approve" ? (kind === "plan" ? "方案已批准，开始实现" : "已批准，正在合并发布") : "已驳回");
      setRejecting(null);
      setReason("");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  const info = stageInfo(task.stage);
  const Check = ({ label, ok }: { label: string; ok: boolean | undefined }) => (
    <li className="flex items-center gap-2 text-[13px]">
      {ok === undefined ? <Hourglass className="size-4 text-ink-3" aria-hidden /> : ok ? <CheckCircle2 className="size-4 text-ok" aria-hidden /> : <XCircle className="size-4 text-bad" aria-hidden />}
      <span>{label}</span>
      <span className={ok === undefined ? "ml-auto text-ink-3" : ok ? "ml-auto text-ok" : "ml-auto text-bad"}>{ok === undefined ? "暂无" : ok ? "通过" : "未通过"}</span>
    </li>
  );

  return (
    <Card className="p-4">
      {task.stage === "plan_reviewing" && (
        <div className="grid gap-3">
          <h2 className="text-[15px] font-semibold">方案审核</h2>
          <p className="text-[13px] text-ink-2">{technicalPlan.data?.plan ? `请在「技术方案」中查看第 ${technicalPlan.data.plan.round} 轮、版本 ${technicalPlan.data.plan.revision}。批准后，智能体会按照这个版本开始实现。` : "请查看会话中的方案。批准后智能体开始实现；驳回后任务结束。"}</p>
          {technicalPlan.error && <p role="alert" className="text-xs text-bad">无法读取方案版本，请刷新后重试。</p>}
          <Button variant="primary" loading={busy === "approve"} disabled={technicalPlan.loading || !!technicalPlan.error || !!busy} onClick={() => decide("plan", "approve")}>
            批准方案，开始实现
          </Button>
          <Button variant="danger" disabled={!!busy} onClick={() => setRejecting("plan")}>
            驳回
          </Button>
        </div>
      )}

      {task.stage === "reviewing" && (
        <div className="grid gap-3">
          <h2 className="text-[15px] font-semibold">发布审核</h2>
          {task.pr_url ? (
            <LinkButton href={task.pr_url} external>
              <GitPullRequest className="size-4" aria-hidden />
              在 GitHub 查看 PR #{task.pr_number}
              <ExternalLink className="size-3.5" aria-hidden />
            </LinkButton>
          ) : (
            <div className="grid gap-2 rounded-control bg-warn-soft px-3 py-2 text-[13px] text-warn">
              <p>PR 还没有创建。{publish && !publish.ok ? `推送或创建失败：${publish.output ?? ""}。守护进程每分钟会自动重试，也可以现在手动重试。` : "稍候片刻。"}</p>
              <div>
                <Button size="sm" loading={busy === "republish"} disabled={!!busy} onClick={republish}>
                  重新推送并创建 PR
                </Button>
              </div>
            </div>
          )}
          <ul className="grid gap-1.5 rounded-control bg-canvas px-3 py-2.5">
            <Check label="测试" ok={test?.ok} />
            <Check label="预览" ok={preview?.ok} />
            <Check label="推送与 PR" ok={task.pr_url ? true : publish?.ok} />
          </ul>
          <p className="num text-xs text-ink-2">将合并的提交：{shortSha(task.head_sha)}</p>
          <p className="text-xs text-ink-2">批准后只会合并这个提交；合并前主分支如有更新，会自动同步并要求你重新审核。有瑕疵就在会话里评论，智能体会在同一个 PR 上继续改。</p>
          <Button variant="primary" loading={busy === "approve"} disabled={!task.head_sha || !task.pr_url} onClick={() => decide("review", "approve")}>
            <GitMerge className="size-4" aria-hidden />
            批准并合并
          </Button>
          <Button variant="danger" disabled={!!busy} onClick={() => setRejecting("review")}>
            驳回
          </Button>
        </div>
      )}

      {task.stage === "publish_review" && (
        <div className="grid gap-3">
          <h2 className="text-[15px] font-semibold">确认发布结果</h2>
          <p className="text-[13px] text-ink-2">PR 已合并，智能体执行了发布，但没有明确给出“发布结果：成功/失败”。请看它的总结并核对线上结果后确认。</p>
          {task.error && <p className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded-control bg-canvas px-3 py-2 text-[13px] text-ink-2">{task.error}</p>}
          <Button variant="primary" loading={busy === "approve"} disabled={!!busy} onClick={() => confirmPublish(true)}>
            <CheckCircle2 className="size-4" aria-hidden />
            发布成功
          </Button>
          <Button variant="danger" loading={busy === "reject"} disabled={!!busy} onClick={() => confirmPublish(false)}>
            发布失败
          </Button>
        </div>
      )}

      {task.stage === "needs_you" && (
        <div className="grid gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <AlertTriangle className="size-4 text-warn" aria-hidden />
            需要你
          </h2>
          <p className="text-[13px] text-ink-2">智能体在等你的决定。请在会话里点选项，或直接回复。</p>
        </div>
      )}

      {task.stage === "published" && (
        <div className="grid gap-3">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-ok">
            <CheckCircle2 className="size-4" aria-hidden />
            已发布
          </h2>
          <p className="text-[13px] text-ink-2">PR 已合并，发布已确认完成。</p>
          {task.pr_url && (
            <LinkButton href={task.pr_url} external>
              查看 PR #{task.pr_number}
              <ExternalLink className="size-3.5" aria-hidden />
            </LinkButton>
          )}
        </div>
      )}

      {task.stage === "failed" && (
        <div className="grid gap-2">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-bad">
            <XCircle className="size-4" aria-hidden />
            执行失败
          </h2>
          <p className="break-words text-[13px] text-ink-2">{task.error ?? "没有记录原因，请查看“检查”和“活动”。"}</p>
          {task.pr_number && (
            <>
              <p className="text-xs text-ink-3">如果其实已经发布成功（例如合并 PR 会自动触发部署），可以手动改正。</p>
              <Button onClick={() => setMarking("published")}>标记为已发布</Button>
            </>
          )}
          {canRestore(task.stage) && <RestoreHint busy={busy === "restore"} disabled={!!busy} onRestore={restore} />}
        </div>
      )}

      {["received", "batched", "held", "queued", "running", "plan_approved", "approved", "publishing", "rejected", "cancelled"].includes(task.stage) && (
        <div className="grid gap-1.5">
          <h2 className="text-[15px] font-semibold">{info.label}</h2>
          <p className="text-[13px] text-ink-2">{info.hint}</p>
          {["rejected", "cancelled"].includes(task.stage) && <RestoreHint busy={busy === "restore"} disabled={!!busy} onRestore={restore} />}
          {["approved", "publishing"].includes(task.stage) && (
            <>
              <p className="text-xs text-ink-3">长时间没有进展，或已经确认发布完成，可以手动改结果。</p>
              <Button onClick={() => setMarking("published")}>标记为已发布</Button>
              <Button variant="danger" onClick={() => setMarking("failed")}>
                标记为失败
              </Button>
            </>
          )}
        </div>
      )}

      <Dialog open={!!marking} onOpenChange={(v) => !v && setMarking(null)} title={marking === "published" ? "手动标记为已发布？" : "手动标记为失败？"} description="这会直接改写任务结果并释放守护进程的租约，不会再执行合并或发布。">
        <div className="grid gap-4">
          <Field label="备注（可选）">{(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setMarking(null)}>取消</Button>
            <Button variant={marking === "failed" ? "danger" : "primary"} loading={!!busy} onClick={() => marking && override(marking)}>
              确认
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog open={!!rejecting} onOpenChange={(v) => !v && setRejecting(null)} title="驳回这个任务？" description="驳回后任务结束，不会合并。想让智能体继续改，请改为在会话里评论。">
        <div className="grid gap-4">
          <Field label="原因（可选）">{(id) => <Textarea id={id} value={reason} onChange={(e) => setReason(e.target.value)} rows={3} />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setRejecting(null)}>取消</Button>
            <Button variant="danger" loading={busy === "reject"} onClick={() => rejecting && decide(rejecting, "reject", reason)}>
              确认驳回
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}

/** 取消、驳回、失败后的“改回待审核”：误操作或想接着用已有的改动时用 */
function RestoreHint({ busy, disabled, onRestore }: { busy: boolean; disabled: boolean; onRestore: () => void }) {
  return (
    <>
      <p className="text-xs text-ink-3">如果是误操作，或想接着用已有的改动：改回“待审核”，守护进程会重建工作树、重新推送并创建 PR（本机需要还留着这个任务的会话记录）。</p>
      <Button loading={busy} disabled={disabled} onClick={onRestore}>
        恢复到待审核（重新创建 PR）
      </Button>
    </>
  );
}
