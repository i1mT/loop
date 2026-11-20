"use client";
import { useEffect, useState } from "react";
import type { DeliverySettings, TestEnvironment } from "@loop/core";
import type { ProjectItem } from "@/lib/types.ts";
import { ApiError, apiPatch, mutate } from "@/lib/client-api.ts";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { SaveBar } from "./save-bar.tsx";

const EMPTY: TestEnvironment = { url: "", username: "", password: "", workflow: "" };
const FIELDS = [
  { key: "url", label: "访问地址", placeholder: "https://example.com" },
  { key: "username", label: "测试账号", placeholder: "可选" },
  { key: "password", label: "测试密码", placeholder: "可选" },
  { key: "workflow", label: "GitHub Actions 部署 workflow", placeholder: "deploy.yml（GitLab 留空）" },
] as const;

export function DeliverySettingsForm({ project }: { project: ProjectItem }) {
  const initial = JSON.stringify(project.delivery_settings ?? { preview: EMPTY, production: EMPTY });
  const [form, setForm] = useState<DeliverySettings>(() => JSON.parse(initial));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const disabled = project.canManage === false;
  useEffect(() => setForm(JSON.parse(initial)), [initial]);
  async function save() {
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/projects/${project.id}`, { deliverySettings: form });
      mutate("/api/projects");
      mutate(`/api/projects/${project.id}`);
      toast("ok", "环境设置已保存，新任务将使用 dev → main 流程");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "环境设置保存失败");
    } finally {
      setBusy(false);
    }
  }

  return <Card>
    <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">部署与测试环境</h2>
    <form className="grid gap-4 p-4" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <p className="text-[13px] text-ink-2">在 dev 和 main 分支配置自动部署。智能体会在部署完成后使用这里的专用账号测试，账号和密码会直接显示。</p>
      <div className="grid gap-4 md:grid-cols-2">
        {(["preview", "production"] as const).map((kind) => <fieldset key={kind} className="grid min-w-0 gap-3 rounded-control border border-line p-3" disabled={disabled || busy}>
          <legend className="px-1.5 text-[13px] font-semibold">{kind === "preview" ? "预览环境 · dev" : "生产环境 · main"}</legend>
          {FIELDS.map(({ key, label, placeholder }) => <Field key={key} label={label}>{(id) => <Input id={id} type={key === "url" ? "url" : "text"} value={form[kind][key]} placeholder={placeholder} autoComplete="off" spellCheck={false} required={key === "url"} onChange={(event) => setForm({ ...form, [kind]: { ...form[kind], [key]: event.target.value } })} />}</Field>)}
        </fieldset>)}
      </div>
      <SaveBar busy={busy} dirty={JSON.stringify(form) !== initial} disabled={disabled || !form.preview.url || !form.production.url} error={error} />
    </form>
  </Card>;
}
