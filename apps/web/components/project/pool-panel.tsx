"use client";
import { Layers } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { EmptyState } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import { SCALE_LABEL } from "@/lib/status.ts";
import type { GlobalPool, TaskItem } from "@/lib/types.ts";

/** 全局任务页“等待合并”标签的内容：按项目分组列出还没有任务的小反馈，可以撤回，或不等凑满直接“立即处理”。 */
export function PoolPanel({ pool, items }: { pool: GlobalPool; items: GlobalPool["items"] }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  if (items.length === 0)
    return (
      <EmptyState icon={<Layers className="size-5" aria-hidden />} title="没有等待合并的小反馈">
        {pool.enabled ? `规模不超过“${SCALE_LABEL[pool.maxScale]}”的新反馈会先在这里等着，同一个项目攒够 ${pool.size} 条就自动合成一个任务。` : "小问题合并目前是关闭的（在“设置”里开启），所有反馈都直接建任务。"}
      </EmptyState>
    );

  const groups = [...Map.groupBy(items, (i) => i.project_id).entries()];

  async function flush(projectId: string) {
    setBusy(`flush:${projectId}`);
    try {
      const r = await apiPost<{ task: TaskItem }>(`/api/projects/${projectId}/pool/flush`);
      mutate("/api/tasks");
      mutate("/api/pool");
      toast("ok", "已合成一个任务，开始处理");
      router.push(`/tasks/${r.task.id}`);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "处理失败");
      setBusy(null);
    }
  }
  async function withdraw(id: string) {
    setBusy(`w:${id}`);
    try {
      await apiPost(`/api/feedbacks/${id}/withdraw`);
      mutate("/api/pool");
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "撤回失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="divide-y divide-line">
      {groups.map(([projectId, list]) => (
        <section key={projectId}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 bg-sunken/50 px-4 py-2.5">
            <div className="min-w-0 flex-1 basis-56 text-sm">
              <Link href={`/projects/${projectId}/tasks`} className="font-medium hover:underline">
                {list[0].project_name}
              </Link>
              <span className="ml-2 text-xs text-ink-2">
                {list.length} 条{list.length >= pool.size ? "，已凑满，马上开始" : `，再来 ${pool.size - list.length} 条自动开始`}
              </span>
            </div>
            <Button variant="primary" size="sm" loading={busy === `flush:${projectId}`} disabled={busy !== null && busy !== `flush:${projectId}`} onClick={() => flush(projectId)}>
              立即处理
            </Button>
          </div>
          <ul className="divide-y divide-line">
            {list.map((f) => (
              <li key={f.id} className="flex items-start gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{f.title.replace(/^\[反馈\]\s*/, "")}</div>
                  {f.preview && <p className="mt-0.5 line-clamp-2 text-[13px] text-ink-2">{f.preview}</p>}
                  <div className="mt-1 text-xs text-ink-3">
                    {f.scale ? `规模 ${SCALE_LABEL[f.scale] ?? f.scale} · ` : ""}
                    {{ sdk: "网站 SDK", api: "API", manual: "手动创建" }[f.source] ?? f.source} · {timeAgo(f.created_at)}
                  </div>
                </div>
                <button type="button" className="shrink-0 pt-0.5 text-xs text-ink-2 underline underline-offset-2 hover:text-bad disabled:opacity-50" disabled={busy !== null} onClick={() => withdraw(f.id)}>
                  {busy === `w:${f.id}` ? "撤回中" : "撤回"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
