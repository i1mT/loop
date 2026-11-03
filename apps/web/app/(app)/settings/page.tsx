"use client";
import { LogOut } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { InlineError } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost } from "@/lib/client-api.ts";
import { Card } from "@/components/ui/page-header.tsx";
import { Skeleton } from "@/components/ui/states.tsx";
import { useApi } from "@/lib/client-api.ts";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 px-4 py-3.5 sm:grid-cols-[180px_1fr] sm:gap-4">
      <dt className="text-[13px] text-ink-2">{label}</dt>
      <dd className="min-w-0 break-words text-sm">{children}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const status = useApi<{ user: { email: string; name: string } | null; mode: "cloud" | "local"; host: string; upstream: string | null; machineId: string | null; version: string }>("/api/status");
  const s = status.data;
  return (
    <>
      <Card className="mb-6">
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">连接</h2>
        {status.loading ? (
          <div className="grid gap-3 p-4">
            <Skeleton className="h-5 w-64" />
            <Skeleton className="h-5 w-48" />
          </div>
        ) : (
          <dl className="divide-y divide-line">
            <Row label="运行模式">{s ? (s.mode === "local" ? "本地（页面运行在本机，数据读写云端）" : "云端") : "无法获取"}</Row>
            <Row label="网关地址">
              <span className="num">{s?.host ?? "—"}</span>
            </Row>
            {s?.mode === "local" && (
              <>
                <Row label="数据来源">
                  <span className="num">{s.upstream}</span>
                  <span className="block text-xs text-ink-2">页面的所有数据读写都转发到云端，云端令牌只保存在本机服务端，浏览器拿不到。</span>
                </Row>
                <Row label="本机">
                  <span className="num">{s.machineId ?? "未设置机器 ID"}</span>
                </Row>
              </>
            )}
            <Row label="版本">
              <span className="num">{s?.version ?? "—"}</span>
            </Row>
          </dl>
        )}
      </Card>
      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">账户</h2>
        <dl className="divide-y divide-line">
          <Row label="当前账号">
            <span className="num">{s?.user?.email ?? "…"}</span>
          </Row>
          <Row label="登录方式">邮箱与密码。浏览器只保存 HttpOnly 的会话 cookie，页面脚本读不到。</Row>
          <Row label="API 令牌与守护进程令牌">脚本、本地网关和各台机器的守护进程使用单独的令牌，只配置在服务端或机器上的 ~/.config/loop/loop.env，不在页面上展示，也不能用来登录。</Row>
        </dl>
        {s?.mode !== "local" && <PasswordForm />}
        {s?.mode === "local" && <p className="border-t border-line px-4 py-3 text-[13px] text-ink-2">本地模式下请在云端网页里修改密码。</p>}
        <div className="border-t border-line p-4">
          <Button
            onClick={async () => {
              await fetch("/api/logout", { method: "POST" });
              location.href = "/login";
            }}
          >
            <LogOut className="size-4" aria-hidden />
            退出登录
          </Button>
        </div>
      </Card>
    </>
  );
}

function PasswordForm() {
  const toast = useToast();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mismatch = again && next !== again ? "两次输入的新密码不一致" : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPost("/api/account/password", { currentPassword: current, newPassword: next });
      toast("ok", "密码已修改，其它设备上的登录已失效");
      setCurrent("");
      setNext("");
      setAgain("");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "修改失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 border-t border-line p-4 [&>*]:sm:max-w-md">
      <h3 className="text-[13px] font-semibold">修改密码</h3>
      <Field label="当前密码">{(id) => <Input id={id} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />}</Field>
      <Field label="新密码" hint="至少 8 位">{(id) => <Input id={id} type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />}</Field>
      <Field label="再输入一次新密码" error={mismatch}>{(id) => <Input id={id} type="password" value={again} onChange={(e) => setAgain(e.target.value)} autoComplete="new-password" />}</Field>
      {error && <InlineError>{error}</InlineError>}
      <div>
        <Button type="submit" variant="primary" loading={busy} disabled={!current || next.length < 8 || next !== again}>
          修改密码
        </Button>
      </div>
    </form>
  );
}
