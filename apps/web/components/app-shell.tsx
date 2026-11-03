"use client";
import * as D from "@radix-ui/react-dialog";
import clsx from "clsx";
import { Cloud, HardDrive, ListChecks, FolderGit2, LogOut, Menu, MonitorSmartphone, Plus, Settings, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type FormEvent, type ReactNode } from "react";
import { CountBadge } from "@/components/ui/badge.tsx";
import { ToastProvider } from "@/components/ui/toast.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Picker } from "@/components/ui/select.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, SPACE_STORAGE, useApi } from "@/lib/client-api.ts";
import { stageInfo } from "@/lib/status.ts";

interface Status {
  user: { email: string; name: string } | null;
  mode: "cloud" | "local";
  host: string;
  upstream: string | null;
  machineId: string | null;
  version: string;
}
interface TaskLite {
  stage: string;
}

const NAV = [
  { href: "/", label: "任务", icon: ListChecks },
  { href: "/projects", label: "项目", icon: FolderGit2 },
  { href: "/machines", label: "机器", icon: MonitorSmartphone },
  { href: "/settings", label: "设置", icon: Settings },
];

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2 px-2 py-1 font-semibold tracking-[-0.01em]">
      <span className="grid size-6 place-items-center rounded-md bg-ink text-card" aria-hidden>
        <span className="size-2 rounded-full bg-signal" />
      </span>
      Loop
    </Link>
  );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const path = usePathname();
  const status = useApi<Status>("/api/status", { poll: 30000 });
  const tasks = useApi<{ tasks: TaskLite[] }>("/api/tasks", { poll: 8000 });
  const attention = (tasks.data?.tasks ?? []).filter((t) => ["attention", "review"].includes(stageInfo(t.stage).group)).length;
  const connected = !status.error;
  const local = status.data?.mode === "local";
  const spaces = useApi<{ super?: boolean; spaces: { id: string; name: string }[]; current: string | null }>("/api/spaces");
  const current = spaces.data?.spaces.find((s) => s.id === spaces.data?.current) ?? spaces.data?.spaces[0];
  const [creating, setCreating] = useState(false);

  function switchSpace(id: string) {
    localStorage.setItem(SPACE_STORAGE, id);
    location.href = "/";
  }

  async function logout() {
    await fetch("/api/logout", { method: "POST" });
    location.href = "/login";
  }

  return (
    <div className="flex h-full flex-col">
      <div className="px-3 pb-3 pt-4">
        <Brand />
        {spaces.data && (spaces.data.spaces.length > 0 || spaces.data.super) && (
          <div className="mt-3">
            <Picker
              ariaLabel="当前空间"
              value={current?.id ?? ""}
              placeholder="选择空间"
              options={spaces.data.spaces.map((s) => ({ value: s.id, label: s.name }))}
              onChange={switchSpace}
              header={
                spaces.data.super ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mb-1 w-full justify-start gap-2 px-2.5 text-sm text-ink"
                    onPointerDown={(e) => e.preventDefault()}
                    onClick={() => setCreating(true)}
                  >
                    <Plus className="size-4" aria-hidden />
                    新建空间
                  </Button>
                ) : null
              }
            />
          </div>
        )}
        <NewSpaceDialog open={creating} onOpenChange={setCreating} onCreated={switchSpace} />
      </div>
      <nav aria-label="主导航" className="grid gap-0.5 px-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" || path.startsWith("/tasks") : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={clsx("flex h-9 items-center gap-2.5 rounded-control px-2.5 text-sm transition-colors", active ? "bg-ink text-card" : "text-ink-2 hover:bg-sunken hover:text-ink")}
            >
              <Icon className="size-4" aria-hidden />
              {label}
              {href === "/" && <CountBadge n={attention} />}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto grid gap-2 border-t border-line p-3 text-[13px]">
        <div className="flex items-center gap-2 text-ink-2" title={status.data ? (local ? `本地网关 ${status.data.host}，数据来自 ${status.data.upstream}` : status.data.host) : undefined}>
          {local ? <HardDrive className="size-4" aria-hidden /> : <Cloud className="size-4" aria-hidden />}
          <span className="text-ink">{status.data ? (local ? "本地" : "云端") : "…"}</span>
          <span className={clsx("ml-auto inline-flex items-center gap-1.5", connected ? "text-ink-2" : "text-bad")}>
            <span className={clsx("size-1.5 rounded-full", connected ? "bg-ok" : "bg-bad")} aria-hidden />
            {connected ? "已连接" : "连接中断"}
          </span>
        </div>
        {status.data?.user && <div className="truncate px-1 text-xs text-ink-2" title={status.data.user.email}>{status.data.user.email}</div>}
        <button onClick={logout} className="flex h-8 cursor-pointer items-center gap-2 rounded-control px-1 text-ink-2 hover:text-ink">
          <LogOut className="size-4" aria-hidden />
          退出登录
        </button>
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const immersive = usePathname() === "/tasks/new";
  return (
    <ToastProvider>
      <div className="min-h-dvh lg:grid lg:grid-cols-[232px_1fr]">
        <aside className="sticky top-0 hidden h-dvh border-r border-line bg-card lg:block">
          <Sidebar />
        </aside>

        <div className="sticky top-0 z-30 flex h-12 items-center gap-2 border-b border-line bg-card px-3 lg:hidden">
          <D.Root open={open} onOpenChange={setOpen}>
            <D.Trigger className="grid size-8 cursor-pointer place-items-center rounded-control hover:bg-sunken" aria-label="打开菜单">
              <Menu className="size-5" />
            </D.Trigger>
            <D.Portal>
              <D.Overlay className="fixed inset-0 z-40 bg-ink/40" />
              <D.Content className="fixed inset-y-0 left-0 z-50 w-64 border-r border-line bg-card shadow-pop">
                <D.Title className="sr-only">导航</D.Title>
                <D.Description className="sr-only">页面导航</D.Description>
                <D.Close className="absolute right-2 top-3 grid size-7 cursor-pointer place-items-center rounded-control text-ink-2 hover:bg-sunken" aria-label="关闭菜单">
                  <X className="size-4" />
                </D.Close>
                <Sidebar onNavigate={() => setOpen(false)} />
              </D.Content>
            </D.Portal>
          </D.Root>
          <Brand />
        </div>

        {/* 沉浸式页面（写任务）占满内容区，不加边距和最大宽度 */}
        <main className={immersive ? "min-w-0" : "mx-auto w-full min-w-0 max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8"}>{children}</main>
      </div>
    </ToastProvider>
  );
}

function NewSpaceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated: (id: string) => void }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ space: { id: string } }>("/api/spaces", { name });
      mutate("/api/spaces");
      toast("ok", "空间已创建");
      setName("");
      onOpenChange(false);
      onCreated(r.space.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="新建空间" description="新空间是空的，不会成为新账号的默认去处。">
      <form className="grid gap-4" onSubmit={submit}>
        <Field label="名称">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="例如：客户甲" />}</Field>
        {error && <p className="text-sm text-bad">{error}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={busy} disabled={!name.trim()}>创建</Button>
        </div>
      </form>
    </Dialog>
  );
}
