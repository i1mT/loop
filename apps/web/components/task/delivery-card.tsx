"use client";
import { useState } from "react";
import Link from "next/link";
import { isDeliveryStage, type DeliveryState, type DeploymentRun } from "@loop/core";
import { Button, LinkButton } from "@/components/ui/button.tsx";
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

export function DeliveryCard({ task, state, reload }: { task: TaskItem; state: DeliveryState; reload: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isDeliveryStage(task.stage) && task.stage !== "published") return null;
  const release = state.release;
  const preview = state.previewResult;
  const production = state.productionResult;
  async function act(action: "retry" | "merge") {
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/tasks/${task.id}/delivery`, { action, head: release?.head, number: release?.number });
      reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }
  return <section className="mb-3 grid min-w-0 gap-3 rounded-control border border-line bg-card p-4">
    <h2 className="text-[15px] font-semibold">{task.stage === "published" ? "部署与测试结果" : stageInfo(task.stage).label}</h2>
    {task.stage === "production_review" && !release && !task.error && <p className="text-[13px] text-ink-2">预览测试已通过，正在准备生产 PR/MR。</p>}
    {(state.previewMerge || task.stage === "preview_deploy") && <PipelineRun label="预览部署" run={state.previewRun} sha={state.previewSha ?? state.previewMerge ?? undefined} />}
    {preview && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">预览测试 · {state.previewPassed ? "通过" : "失败"}</summary><p className="mt-2 break-words whitespace-pre-wrap text-ink-2">{preview}</p></details>}
    {release && <div className="grid gap-2 border-t border-line pt-3">
      <div className="flex flex-wrap items-center gap-2">
        <LinkButton href={release.url} external size="sm">dev → main #{release.number}</LinkButton>
        <span className="num text-xs text-ink-2">{shortSha(release.head)}</span>
      </div>
      <ul className="grid gap-1 text-[13px]">{release.tasks.map((item) => <li key={`${item.id}:${item.round}`} className="min-w-0 break-words"><Link href={`/tasks/${item.id}`} className="underline underline-offset-2">{item.title}</Link></li>)}</ul>
      {task.stage === "production_review" && !state.productionMerge && <Button size="sm" variant="primary" loading={busy} onClick={() => void act("merge")}>合并到 main</Button>}
    </div>}
    {state.productionMerge && <PipelineRun label="生产部署" run={state.productionRun} sha={state.productionSha ?? state.productionMerge} />}
    {production && <details className="min-w-0 text-[13px]"><summary className="cursor-pointer">生产回归 · {task.stage === "published" ? "通过" : "结果"}</summary><p className="mt-2 break-words whitespace-pre-wrap text-ink-2">{production}</p></details>}
    {(task.error || error) && <InlineError>{error || task.error}</InlineError>}
    {task.error && isDeliveryStage(task.stage) && <Button size="sm" loading={busy} onClick={() => void act("retry")}>重试当前步骤</Button>}
  </section>;
}
