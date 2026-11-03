"use client";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, InlineError, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPut, mutate, useApi } from "@/lib/client-api.ts";

interface Spaces {
  super: boolean;
  current: string | null;
  members: { email: string; name: string; role: string }[];
}

/** 只回答「当前空间里有谁」。加人用弹窗。建空间、建账号、接机器在各自的页面。 */
export default function SpaceMembersPage() {
  const toast = useToast();
  const data = useApi<Spaces>("/api/spaces");
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [removingBusy, setRemovingBusy] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const s = data.data;
  const currentOk = !!s?.current && s.current !== "space_none";

  async function add(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPut("/api/spaces", { email });
      mutate("/api/spaces");
      toast("ok", "已加入");
      setEmail("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(memberEmail: string) {
    setRemovingBusy(true);
    try {
      await apiPut("/api/spaces", { email: memberEmail, remove: true });
      mutate("/api/spaces");
      toast("ok", "已移出");
      setRemoving(null);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "失败");
    } finally {
      setRemovingBusy(false);
    }
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        {s?.super && (
          <Button onClick={() => setOpen(true)} disabled={!currentOk}>
            加入成员
          </Button>
        )}
      </div>
      <Dialog open={open} onOpenChange={setOpen} title="加入当前空间" description="账号需要已经存在。新建账号在「账号」页。">
        <form className="grid gap-4" onSubmit={add}>
          <Field label="邮箱">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
          {error && <InlineError>{error}</InlineError>}
          <div className="flex justify-end">
            <Button type="submit" variant="primary" loading={busy} disabled={!email.trim()}>加入</Button>
          </div>
        </form>
      </Dialog>
      <Dialog open={!!removing} onOpenChange={(v) => !v && setRemoving(null)} title="移出这个成员？" description={removing ? `${removing} 将不能再看到当前空间的项目和任务。` : undefined}>
        <div className="flex justify-end gap-2">
          <Button onClick={() => setRemoving(null)}>取消</Button>
          <Button
            variant="danger"
            loading={removingBusy}
            onClick={() => {
              if (!removing) return;
              void remove(removing);
            }}
          >
            确认移出
          </Button>
        </div>
      </Dialog>
      {data.loading && <Skeleton className="h-40" />}
      {data.error && <InlineError>{data.error.message}</InlineError>}
      {s && (
        <Card>
          {s.members.length === 0 ? (
            <EmptyState title="还没有成员">{s.super ? "用右上角把已有账号加进来。" : "等超级管理员分配。"}</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {s.members.map((m) => (
                <li key={m.email} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                  <span className="min-w-0 truncate">{m.email}</span>
                  <span className="flex items-center gap-3">
                    <span className="text-ink-2">{m.role === "owner" ? "所有者" : "成员"}</span>
                    {s.super && (
                      <Button size="sm" variant="danger" onClick={() => setRemoving(m.email)}>移出</Button>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </>
  );
}
