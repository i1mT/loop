"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { InlineError } from "@/components/ui/states.tsx";
import { ApiError, apiPut } from "@/lib/client-api.ts";
import type { FeishuSettings } from "./types.ts";

export function RouteDialog({ data, open, onOpenChange, saved }: { data: FeishuSettings; open: boolean; onOpenChange: (open: boolean) => void; saved: () => void }) {
  const [chatId, setChatId] = useState("");
  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try { await apiPut("/api/feishu/routes", { chatId: chatId.trim(), projectId, enabled: true }); saved(); onOpenChange(false); }
    catch (e) { setError(e instanceof ApiError ? e.message : "保存失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange} title="连接群聊与项目" description="将机器人加入群聊后，群成员可以通过 @ 机器人创建这个项目的任务。">
    <form onSubmit={save} className="grid gap-4">
      <Field label="飞书群 ID">{(id) => <Input id={id} value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="oc_…" required autoFocus />}</Field>
      <Field label="对应项目">{() => <Picker value={projectId} onChange={setProjectId} ariaLabel="对应项目" options={data.projects.map((p) => ({ value: p.id, label: p.name }))} />}</Field>
      {data.projects.length === 0 && <p className="text-sm text-ink-2">请先在当前空间创建项目。</p>}
      {error && <InlineError>{error}</InlineError>}
      <div className="flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" variant="primary" loading={busy} disabled={!projectId || !chatId.trim()}>连接群聊</Button></div>
    </form>
  </Dialog>;
}
