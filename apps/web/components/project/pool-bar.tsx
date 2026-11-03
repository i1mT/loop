"use client";
import { Layers } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { SCALE_LABEL } from "@/lib/status.ts";
import type { PoolItem, TaskItem } from "@/lib/types.ts";

/** 项目“任务”页顶部：有小反馈在等待合并时显示。可以逐条撤回，或不等凑满直接“立即处理”。没有就不显示。 */
export function PoolBar({ projectId }: { projectId: string }) {
  const toast = useToast();
  const router = useRouter();
  const pool = useApi<{ pool: PoolItem }>(`/api/projects/${projectId}/pool`, { poll: 8000 });
  const [busy, setBusy] = useState<string | null>(null);
  const p = pool.data?.pool;
  if (!p || p.items.length === 0) return null;

  async function flush() {
    setBusy("flush");
    try {
      const r = await apiPost<{ task: TaskItem }>(`/api/projects/${projectId}/pool/flush`);
      mutate("/api/tasks");
      mutate(`/api/projects/${projectId}/pool`);
      toast("ok", "已合成一个任务，开始处理");
      router.push(`/tasks/${r.task.id}`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "处理失败");
      setBusy(null);
    }
  }
  async function withdraw(id: string) {
    setBusy(id);
    try {
      await apiPost(`/api/feedbacks/${id}/withdraw`);
      mutate(`/api/projects/${projectId}/pool`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "撤回失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Card className="mb-4 border-warn/30 bg-warn-soft/40">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
        <Layers className="size-4 shrink-0 text-warn" aria-hidden />
        <div className="min-w-0 flex-1 basis-64">
          <div className="text-sm font-medium">
            {p.items.length} 条小反馈在等待合并
            <span className="ml-2 text-xs font-normal text-ink-2">
              {p.items.length >= p.size ? "已凑满，马上开始" : `再来 ${p.size - p.items.length} 条自动开始，也可以现在就处理`}
            </span>
          </div>
        </div>
        <Button variant="primary" size="sm" loading={busy === "flush"} disabled={busy !== null && busy !== "flush"} onClick={flush}>
          立即处理
        </Button>
      </div>
      <ul className="divide-y divide-line border-t border-line">
        {p.items.map((f) => (
          <li key={f.id} className="flex items-center gap-3 px-4 py-2 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{f.title}</span>
            {f.scale && <span className="shrink-0 text-xs text-ink-3">规模 {SCALE_LABEL[f.scale] ?? f.scale}</span>}
            <button type="button" className="shrink-0 text-xs text-ink-2 underline underline-offset-2 hover:text-bad disabled:opacity-50" disabled={busy !== null} onClick={() => withdraw(f.id)}>
              {busy === f.id ? "撤回中" : "撤回"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}
