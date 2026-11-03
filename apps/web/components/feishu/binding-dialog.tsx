"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Checkbox, Field, Input } from "@/components/ui/field.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { InlineError } from "@/components/ui/states.tsx";
import { ApiError, apiPut } from "@/lib/client-api.ts";
import type { FeishuSettings } from "./types.ts";

export function BindingDialog({ data, open, onOpenChange, saved }: { data: FeishuSettings; open: boolean; onOpenChange: (open: boolean) => void; saved: () => void }) {
  const b = data.binding;
  const [form, setForm] = useState({ appId: b?.appId ?? "", appSecret: "", verificationToken: "", encryptKey: "", tenantKey: b?.tenantKey ?? "", wikiUrl: b?.wikiUrl ?? "", defaultProjectId: b?.defaultProjectId ?? "none", notificationChatId: b?.notificationChatId ?? "", enabled: b?.enabled ?? true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const update = (key: keyof typeof form, value: string | boolean) => setForm((old) => ({ ...old, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(null);
    try {
      await apiPut("/api/feishu/settings", { ...form, defaultProjectId: form.defaultProjectId === "none" ? null : form.defaultProjectId, notificationChatId: form.notificationChatId.trim() || null, appSecret: form.appSecret || undefined, verificationToken: form.verificationToken || undefined, encryptKey: form.encryptKey || undefined });
      saved(); onOpenChange(false);
    } catch (e) { setError(e instanceof ApiError ? e.message : "保存失败，请稍后重试"); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange} title={b ? "修改飞书机器人" : "绑定飞书机器人"} description="在飞书开放平台创建企业自建应用，开启机器人能力，并将机器人加入目标知识库。" wide>
    <form className="grid gap-4" onSubmit={save}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="App ID">{(id) => <Input id={id} value={form.appId} onChange={(e) => update("appId", e.target.value)} required autoComplete="off" />}</Field>
        <Field label="企业标识（Tenant Key）" hint="用于核对消息所属的飞书企业。">{(id) => <Input id={id} value={form.tenantKey} onChange={(e) => update("tenantKey", e.target.value)} required autoComplete="off" />}</Field>
        <Field label="App Secret" hint={b?.hasSecrets ? "留空保留现有密钥。" : undefined}>{(id) => <Input id={id} type="password" value={form.appSecret} onChange={(e) => update("appSecret", e.target.value)} required={!b?.hasSecrets} autoComplete="new-password" />}</Field>
        <Field label="Verification Token" hint={b?.hasSecrets ? "留空保留现有配置。" : undefined}>{(id) => <Input id={id} type="password" value={form.verificationToken} onChange={(e) => update("verificationToken", e.target.value)} required={!b?.hasSecrets} autoComplete="new-password" />}</Field>
        <Field label="Encrypt Key" hint={b?.hasSecrets ? "留空保留现有配置。" : undefined}>{(id) => <Input id={id} type="password" value={form.encryptKey} onChange={(e) => update("encryptKey", e.target.value)} required={!b?.hasSecrets} autoComplete="new-password" />}</Field>
      </div>
      <Field label="技术方案目录链接" hint="请使用飞书知识库中的父文档链接。每个任务会在该目录下面创建独立文档。">{(id) => <Input id={id} type="url" value={form.wikiUrl} onChange={(e) => update("wikiUrl", e.target.value)} required placeholder="https://你的企业.feishu.cn/wiki/…" />}</Field>
      <Field label="默认项目" hint="单聊没有指定项目时使用。未设置时，机器人会询问创建到哪个项目。">{() => <Picker value={form.defaultProjectId} onChange={(value) => update("defaultProjectId", value)} ariaLabel="默认项目" options={[{ value: "none", label: "每次选择项目" }, ...data.projects.map((project) => ({ value: project.id, label: project.name }))]} />}</Field>
      <Field label="空间通知群" hint="可选。网页等入口创建的任务会向这个群发送状态通知；聊天创建的任务仍然回复原聊天。">{(id) => <Input id={id} value={form.notificationChatId} onChange={(e) => update("notificationChatId", e.target.value)} placeholder="群 ID（oc_…）" />}</Field>
      <Checkbox checked={form.enabled} onChange={(value) => update("enabled", value)} label="启用机器人与技术方案记录" hint="启用后，当前空间的新任务会先保存技术方案，再开始实现。" />
      {error && <InlineError>{error}</InlineError>}
      <div className="flex justify-end gap-2"><Button onClick={() => onOpenChange(false)}>取消</Button><Button type="submit" variant="primary" loading={busy}>保存配置</Button></div>
    </form>
  </Dialog>;
}
