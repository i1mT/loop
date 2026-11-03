"use client";
import { KeyRound, Plus } from "lucide-react";
import { useState } from "react";
import { IntegrationBack } from "@/components/project/integration-back.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Button } from "@/components/ui/button.tsx";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, InlineError, RowsSkeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, request, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";

interface KeyRow {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export default function ApiIntegration() {
  const { project } = useProjectCtx();
  const toast = useToast();
  const path = `/api/projects/${project.id}/api-keys`;
  const keys = useApi<{ keys: KeyRow[] }>(path);
  const status = useApi<{ base: string }>("/api/status");
  const base = status.data?.base ?? "https://你的网关地址";
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  const [revokeBusy, setRevokeBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ secret: string }>(path, { name });
      setSecret(r.secret);
      setName("");
      mutate(path);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(k: KeyRow) {
    setRevokeBusy(true);
    try {
      await request(`${path}/${k.id}`, { method: "DELETE" });
      mutate(path);
      toast("ok", `密钥“${k.name}”已撤销`);
      setRevoking(null);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "撤销失败");
    } finally {
      setRevokeBusy(false);
    }
  }

  const curl = `curl -X POST ${base}/api/v1/tasks \\
  -H "Authorization: Bearer lp_你的密钥" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "登录页按钮文案改成“进入”",
    "body": "产品反馈：……（要改什么、怎样算做好）",
    "priority": "normal",
    "externalRef": { "ticket": "SUP-1024" }
  }'`;
  const resp = `{ "ok": true, "task": { "id": "…", "stage": "queued", "url": "${base}/tasks/…" } }`;
  const list = keys.data?.keys ?? [];

  return (
    <>
      <IntegrationBack projectId={project.id} title="API 接入" />
      <Card className="mb-6 overflow-hidden">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div>
            <h3 className="text-[15px] font-semibold">API 密钥</h3>
            <p className="text-xs text-ink-2">密钥只属于这个项目，只能推送任务和查询这个项目的任务。保存在你的服务端，不要放进前端。</p>
          </div>
          <Button variant="primary" onClick={() => { setSecret(null); setCreating(true); }}>
            <Plus className="size-4" aria-hidden />
            创建密钥
          </Button>
        </div>
        {keys.loading ? (
          <RowsSkeleton rows={2} />
        ) : keys.error && !keys.data ? (
          <ErrorState message={keys.error.message} onRetry={keys.reload} />
        ) : list.length === 0 ? (
          <EmptyState icon={<KeyRound className="size-5" aria-hidden />} title="还没有密钥">创建一个密钥，就可以用下面的接口推送任务了。</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {list.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-1 basis-48">
                  <div className="truncate text-sm font-medium">{k.name}</div>
                  <div className="num text-xs text-ink-2">{k.prefix}••••••••</div>
                </div>
                <div className="text-xs text-ink-2">创建于 {timeAgo(k.createdAt)} · {k.lastUsedAt ? `最近使用 ${timeAgo(k.lastUsedAt)}` : "从未使用"}</div>
                {k.revokedAt ? (
                  <span className="rounded-full bg-sunken px-2 py-0.5 text-xs text-ink-2">已撤销</span>
                ) : (
                  <Button size="sm" variant="danger" onClick={() => setRevoking(k)}>
                    撤销
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mb-6 p-4">
        <h3 className="mb-3 text-[15px] font-semibold">推送任务</h3>
        <CopyBlock text={curl} />
        <p className="mb-1 mt-3 text-[13px] font-medium">响应（201）</p>
        <CopyBlock text={resp} />
        <h4 className="mb-2 mt-5 text-[13px] font-semibold">请求字段</h4>
        <dl className="grid gap-2 text-[13px] sm:grid-cols-[120px_1fr]">
          {[
            ["title", "必填。任务标题，最长 200 字"],
            ["body", "任务说明，最长 20000 字。会原样交给智能体，请只推送你信任的内容"],
            ["priority", "low、normal（默认）、urgent。urgent 会被优先领取"],
            ["planReview", "true 则智能体先只给出方案，你批准后才实现。默认 false"],
            ["releaseReview", "false 则测试通过后自动合并发布。默认 true"],
            ["agent", "指定智能体（必须是项目绑定机器上可用的）。默认用项目绑定的"],
            ["externalRef", "你系统里的引用（工单号等），原样记录，方便对应"],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="num text-ink">{k}</dt>
              <dd className="text-ink-2">{v}</dd>
            </div>
          ))}
        </dl>
        <h4 className="mb-2 mt-5 text-[13px] font-semibold">查询进度</h4>
        <CopyBlock text={`curl ${base}/api/v1/tasks/任务ID \\\n  -H "Authorization: Bearer lp_你的密钥"`} />
        <p className="mt-2 text-xs text-ink-2">返回 stage（内部阶段）、label（可直接展示给用户的进度文案）、pr_url（已创建 PR 时）。</p>
        <h4 className="mb-2 mt-5 text-[13px] font-semibold">错误码</h4>
        <p className="text-[13px] text-ink-2">401 密钥无效或已撤销；400 参数不合法（如智能体不可用）；429 太频繁（每分钟 60 条、每天 5000 条）。</p>
      </Card>

      <Dialog open={creating} onOpenChange={(v) => { setCreating(v); if (!v) setSecret(null); }} title={secret ? "密钥已创建" : "创建 API 密钥"} description={secret ? "这是唯一一次能看到完整密钥的机会，请现在复制并妥善保存。" : "给密钥起个名字，方便以后分辨是谁在用。"}>
        {secret ? (
          <div className="grid gap-4">
            <CopyBlock text={secret} />
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => { setCreating(false); setSecret(null); }}>
                我已保存
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={create} className="grid gap-4">
            <Field label="名称">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：工单系统" maxLength={60} autoFocus />}</Field>
            {error && <InlineError>{error}</InlineError>}
            <div className="flex justify-end gap-2">
              <Button onClick={() => setCreating(false)}>取消</Button>
              <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>
                创建
              </Button>
            </div>
          </form>
        )}
      </Dialog>

      <Dialog open={!!revoking} onOpenChange={(v) => !v && setRevoking(null)} title={`撤销密钥“${revoking?.name}”？`} description="撤销后使用它的系统会立刻收到 401，无法恢复。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRevoking(null)}>取消</Button>
          <Button variant="danger" loading={revokeBusy} onClick={() => revoking && revoke(revoking)}>
            确认撤销
          </Button>
        </div>
      </Dialog>
    </>
  );
}
