"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, InlineError, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, apiPut, mutate, useApi } from "@/lib/client-api.ts";

interface Account {
  email: string;
  name: string;
  role: string;
  spaces: { id: string; name: string }[];
}
interface SpaceOpt {
  id: string;
  name: string;
}

export default function AccountsPage() {
  const who = useApi<{ super: boolean; spaces: SpaceOpt[] }>("/api/spaces");
  const list = useApi<{ accounts: Account[] }>(who.data?.super ? "/api/accounts" : null);
  const [creating, setCreating] = useState(false);
  const [assigning, setAssigning] = useState<Account | null>(null);

  if (who.loading) return <Skeleton className="h-40" />;
  if (who.error) return <InlineError>{who.error.message}</InlineError>;
  if (!who.data?.super) {
    return (
      <Card>
        <EmptyState title="只有超级管理员可以管理账号">账号和能进入的空间由超级管理员分配。</EmptyState>
      </Card>
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" onClick={() => setCreating(true)}>新建账号</Button>
      </div>
      <CreateAccountDialog open={creating} spaces={who.data.spaces} onOpenChange={setCreating} />
      {assigning && <AssignDialog key={assigning.email} account={assigning} spaces={who.data.spaces} onOpenChange={(v) => !v && setAssigning(null)} />}
      {list.loading && <Skeleton className="h-40" />}
      {list.error && <InlineError>{list.error.message}</InlineError>}
      {list.data && (
        <Card>
          {list.data.accounts.length === 0 ? (
            <EmptyState title="还没有账号" />
          ) : (
            <ul className="divide-y divide-line">
              {list.data.accounts.map((a) => (
                <li key={a.email} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{a.email}</div>
                    <div className="truncate text-[13px] text-ink-2">
                      {a.role === "super" ? "可以进入全部空间" : a.spaces.map((s) => s.name).join("、") || "未分配空间"}
                    </div>
                  </div>
                  {a.role !== "super" && (
                    <Button size="sm" onClick={() => setAssigning(a)}>分配空间</Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}

function CreateAccountDialog({ open, spaces, onOpenChange }: { open: boolean; spaces: SpaceOpt[]; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [spaceIds, setSpaceIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ account: { email: string; password: string } }>("/api/accounts", {
        email,
        password: password || undefined,
        spaceIds,
      });
      mutate("/api/accounts");
      mutate("/api/spaces");
      toast("ok", password ? "账号已创建" : `账号已创建。密码只显示这一次：${r.account.password}`);
      setEmail("");
      setPassword("");
      setSpaceIds([]);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="新建账号" description="不会自动进入任何空间，勾选后才会分配。">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="邮箱">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
        <Field label="密码" hint="留空则随机生成，只显示一次">{(id) => <Input id={id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}</Field>
        <fieldset className="grid gap-1.5">
          <legend className="text-[13px] font-medium">可以进入的空间</legend>
          {spaces.map((space) => (
            <label key={space.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={spaceIds.includes(space.id)}
                onChange={(e) => setSpaceIds((ids) => (e.target.checked ? [...ids, space.id] : ids.filter((x) => x !== space.id)))}
              />
              {space.name}
            </label>
          ))}
        </fieldset>
        {error && <InlineError>{error}</InlineError>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>创建</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AssignDialog({ account, spaces, onOpenChange }: { account: Account; spaces: SpaceOpt[]; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [spaceIds, setSpaceIds] = useState<string[]>(account.spaces.map((s) => s.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!account) return;
    setBusy(true);
    setError(null);
    try {
      await apiPut("/api/accounts", { email: account.email, spaceIds });
      mutate("/api/accounts");
      mutate("/api/spaces");
      toast("ok", "已保存");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange} title="分配空间" description={account?.email}>
      <form className="grid gap-4" onSubmit={submit}>
        <fieldset className="grid gap-1.5">
          {spaces.map((space) => (
            <label key={space.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={spaceIds.includes(space.id)}
                onChange={(e) => setSpaceIds((ids) => (e.target.checked ? [...ids, space.id] : ids.filter((x) => x !== space.id)))}
              />
              {space.name}
            </label>
          ))}
        </fieldset>
        {error && <InlineError>{error}</InlineError>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy}>保存</Button>
        </div>
      </form>
    </Dialog>
  );
}
