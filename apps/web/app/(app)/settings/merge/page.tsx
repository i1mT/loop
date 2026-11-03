"use client";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox, Field, Input, Select } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { ErrorState, InlineError, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPut, mutate, useApi } from "@/lib/client-api.ts";
import { SCALE_LABEL } from "@/lib/status.ts";

interface Settings {
  enabled: boolean;
  maxScale: "tiny" | "small" | "medium" | "large";
  size: number;
}

/** 小问题合并：规模不超过门槛的小反馈先进所在项目的池，攒够条数合成一个任务（一个会话、一个 PR） */
export default function MergeSettings() {
  const toast = useToast();
  const r = useApi<{ settings: Settings; keyConfigured: boolean }>("/api/settings/batch");
  const [enabled, setEnabled] = useState(true);
  const [maxScale, setMaxScale] = useState<Settings["maxScale"]>("small");
  const [size, setSize] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const saved = r.data?.settings;
  useEffect(() => {
    if (!saved) return;
    setEnabled(saved.enabled);
    setMaxScale(saved.maxScale);
    setSize(String(saved.size));
  }, [saved?.enabled, saved?.maxScale, saved?.size]);
  const dirty = !!saved && (saved.enabled !== enabled || saved.maxScale !== maxScale || String(saved.size) !== size);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPut("/api/settings/batch", { enabled, maxScale, size: Number(size) });
      mutate("/api/settings/batch");
      toast("ok", "已保存，之后的新反馈按新规则处理");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  if (r.error && !r.data) return <ErrorState message={r.error.message} onRetry={r.reload} />;
  return (
    <Card>
      <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">小问题合并</h2>
      {r.loading ? (
        <div role="status" aria-label="加载中" className="grid gap-3 p-4">
          <Skeleton className="h-5 w-64" />
          <Skeleton className="h-9 w-48" />
        </div>
      ) : (
        <form onSubmit={save} className="grid gap-4 p-4">
          <p className="max-w-2xl text-[13px] text-ink-2">
            新反馈先由 Jev 判定改动规模。规模不超过下面门槛的，先进所在项目的“等待合并”池；同一个项目的池攒够条数，就合成<b>一个任务</b>，由一个会话一次处理、提一个 PR。凑不满的会一直等着，也可以在项目的“任务”页点“立即处理”。
            紧急的、开了“先审核方案”的、指定了别的智能体的、勾了“单独处理”的反馈不参与合并。
          </p>
          {!r.data?.keyConfigured && <InlineError>还没有配置 Jev 密钥（TYPESAFE_API_KEY），这个功能暂时不会生效，所有反馈照常直接建任务。</InlineError>}
          <Checkbox checked={enabled} onChange={setEnabled} label="启用小问题合并" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="合并门槛" hint="规模小于等于它的才进池">
              {(id) => (
                <Select id={id} value={maxScale} onChange={(e) => setMaxScale(e.target.value as Settings["maxScale"])}>
                  {(["tiny", "small", "medium", "large"] as const).map((k) => (
                    <option key={k} value={k}>
                      {SCALE_LABEL[k]}{k === "tiny" ? "（只合并最小一档）" : k === "small" ? "（微小和小）" : k === "medium" ? "（微小、小和中）" : "（全部）"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="每批条数" hint="池里攒够这么多条就合成一个任务（2–10）">
              {(id) => <Input id={id} type="number" min={2} max={10} value={size} onChange={(e) => setSize(e.target.value)} />}
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
  );
}
