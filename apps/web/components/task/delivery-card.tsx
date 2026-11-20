"use client";
import { useState } from "react";
import Link from "next/link";
import { isDeliveryStage, type DeliveryRecovery, type DeliveryState, type DeploymentRun, type ReleaseRequest } from "@loop/core";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { InlineError } from "@/components/ui/states.tsx";
import { ApiError, apiPost } from "@/lib/client-api.ts";
import { shortSha } from "@/lib/format.ts";
import { stageInfo } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";

const RUN_LABEL = { pending: "运行中", success: "成功", failed: "失败", cancelled: "已取消", skipped: "已跳过" } as const;

function PipelineRun({ label, run, sha }: { label: string; run?: DeploymentRun | null; sha?: string }) {
  return <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-[13px]">
    <span className="text-ink-2">{label}{sha ? ` · ${shortSha(sha)}` : ""}</span>
    {run ? <a href={run.url} className="font-medium underline underline-offset-2" target="_blank" rel="noreferrer">{RUN_LABEL[run.status]}</a> : <span className="text-ink-3">等待流水线</span>}
  </div>;
}

const VERIFY_LABEL = { passed: "预览通过", pending: "待验证", repairing: "修复中", failed: "验证失败" } as const;
const RECOVERY_LABEL = { retry: "重跑流水线", repair: "交给原会话修复", blocked: "需要处理" } as const;

type PreviousProduction = { round: number; sha: string; result: string | null; run: DeliveryState["productionRun"]; recovery: DeliveryState["recovery"] };

function RecoveryHistory({ items }: { items: DeliveryRecovery[] }) {
  return <ol className="grid gap-2 text-xs">
    {items.map((item, index) => <li key={`${item.sha}:${index}`} className="rounded-control bg-sunken px-3 py-2">
      <p className="font-medium">{item.environment === "preview" ? "预览" : "生产"} · {RECOVERY_LABEL[item.action]} · <span className="num">{shortSha(item.sha)}</span></p>
      <p className="mt-1 whitespace-pre-wrap break-words text-ink-2">{item.reason}</p>
    </li>)}
  </ol>;
}

export function DeliveryCard({ task, state, previousProduction, reload }: { task: TaskItem; state: DeliveryState; previousProduction?: PreviousProduction | null; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<ReleaseRequest | null>(null);
  const recovering = task.stage === "running" && (!!state.recovery?.length || !!previousProduction);
  if (!isDeliveryStage(task.stage) && task.stage !== "published" && !recovering) return null;
  const release = state.release;
  const preview = state.previewResult;
  const production = state.productionResult;
  async function act(action: "retry" | "merge", batch?: ReleaseRequest) {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/tasks/${task.id}/delivery`, { action, head: batch?.head, number: batch?.number, tasks: batch?.tasks });
      setReviewing(null);
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  const reviewStale = !!reviewing && (task.stage !== "production_review" || JSON.stringify(reviewing) !== JSON.stringify(release));
  return <section className="mb-3 grid min-w-0 gap-3 rounded-control border border-line bg-card p-4">
    <h2 className="text-[15px] font-semibold">{recovering ? "正在修复验证问题" : task.stage === "published" ? "部署与测试结果" : stageInfo(task.stage).label}</h2>
    {task.stage === "production_review" && !release && !task.error && <p className="text-[13px] text-ink-2">预览测试已通过，正在准备生产 PR/MR。</p>}
    {(state.previewMerge || task.stage === "preview_deploy") && <PipelineRun label="预览部署" run={state.previewRun} sha={state.previewSha ?? state.previewMerge ?? undefined} />}
    {preview && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">预览测试 · {state.previewPassed ? "通过" : "失败"}</summary><p className="mt-2 break-words whitespace-pre-wrap text-ink-2">{preview}</p></details>}
    {release && <div className="grid gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={release.url} external size="sm">dev → main #{release.number}</LinkButton>
        <span className="num text-xs text-ink-2">{shortSha(release.head)}</span>
      </div>
      <p className="text-xs text-ink-2">{release.tasks.length} 个 Loop 任务随此提交发布</p>
      {task.stage === "production_review" && !state.productionMerge && <Button size="sm" variant="primary" onClick={() => { setError(null); setReviewing(release); }}>查看发布批次</Button>}
    </div>}
    {state.productionMerge && <PipelineRun label="生产部署" run={state.productionRun} sha={state.productionSha ?? state.productionMerge} />}
    {production && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">生产回归 · {task.stage === "published" ? "通过" : "结果"}</summary><p className="mt-2 break-words whitespace-pre-wrap text-ink-2">{production}</p></details>}
    {!!state.recovery?.length && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">恢复记录 · {state.recovery.length} 次</summary><div className="mt-2"><RecoveryHistory items={state.recovery} /></div></details>}
    {previousProduction && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">第 {previousProduction.round} 轮生产记录</summary><div className="mt-2 grid gap-2">
      <PipelineRun label="生产部署" run={previousProduction.run} sha={previousProduction.sha} />
      {previousProduction.result && <p className="whitespace-pre-wrap break-words text-ink-2">{previousProduction.result}</p>}
      {previousProduction.recovery && <RecoveryHistory items={previousProduction.recovery} />}
    </div></details>}
    {(task.error || (!reviewing && error)) && <InlineError>{task.error || error}</InlineError>}
    <Dialog open={!!reviewing} onOpenChange={(open) => { if (!open && !busy) setReviewing(null); }} title="确认生产发布" description="合并 dev 到 main 会发布此提交包含的所有改动。">
      {reviewing && <div className="grid gap-4">
        <div className="flex items-center justify-between gap-3 rounded-control bg-sunken px-3 py-2 text-[13px]">
          <LinkButton href={reviewing.url} external size="sm">PR/MR #{reviewing.number}</LinkButton>
          <span className="num text-ink-2" title={reviewing.head}>{shortSha(reviewing.head)}</span>
        </div>
        <ul className="divide-y divide-line rounded-control border border-line">
          {reviewing.tasks.map((item) => <li key={`${item.id}:${item.round}`} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
            <Link href={`/tasks/${item.id}`} className="min-w-0 break-words underline underline-offset-2">{item.title}</Link>
            <span className={item.verification === "passed" ? "shrink-0 text-ok" : "shrink-0 text-warn"} title={item.testedSha ?? undefined}>{VERIFY_LABEL[item.verification ?? "pending"]}</span>
          </li>)}
          {!reviewing.tasks.length && <li className="px-3 py-2.5 text-[13px] text-ink-2">该提交没有关联的 Loop 任务。</li>}
        </ul>
        {reviewStale && <InlineError>待合并提交或验证状态已变化，请重新打开确认。</InlineError>}
        {error && <InlineError>{error}</InlineError>}
        <div className="flex justify-end gap-2"><Button disabled={busy} onClick={() => setReviewing(null)}>取消</Button><Button variant="primary" loading={busy} disabled={reviewStale} onClick={() => void act("merge", reviewing)}>合并到 main</Button></div>
      </div>}
    </Dialog>
    {task.error && isDeliveryStage(task.stage) && <Button size="sm" loading={busy} onClick={() => void act("retry")}>重试当前步骤</Button>}
  </section>;
}
