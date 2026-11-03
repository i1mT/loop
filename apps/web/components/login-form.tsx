"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Field, Input } from "@/components/ui/field.tsx";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      if (res.ok) {
        window.location.href = "/";
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? `登录失败（${res.status}）`);
    } catch {
      setError("无法连接到网关，请检查网络");
    }
    setBusy(false);
  }

  return (
    <form onSubmit={submit} className="mt-6 grid gap-4">
      <Field label="邮箱">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus spellCheck={false} />}</Field>
      <Field label="密码" error={error}>
        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" aria-invalid={!!error} />}
      </Field>
      <Button type="submit" variant="primary" loading={busy} disabled={!email || !password}>
        登录
      </Button>
    </form>
  );
}
