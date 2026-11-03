"use client";
import clsx from "clsx";
import { Check, Copy, MonitorSmartphone, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/ui/badge.tsx";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { ApiError, apiPut, mutate, useApi } from "@/lib/client-api.ts";
import { useToast } from "@/components/ui/toast.tsx";
import { timeAgo } from "@/lib/format.ts";
import type { MachineItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

function LinkMachineDialog({ open, machines, onOpenChange }: { open: boolean; machines: { id: string; name: string; online: boolean }[]; onOpenChange: (v: boolean) => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  async function link(id: string) {
    setBusy(id);
    try {
      await apiPut("/api/spaces", { machineId: id });
      mutate("/api/spaces");
      mutate("/api/machines");
      toast("ok", "已接入");
      onOpenChange(false);
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "失败");
    } finally {
      setBusy(null);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="接入到当前空间" description="同一台机器仍只跑一个守护进程，接入后这个空间的项目才能绑定它。">
      {machines.length === 0 ? (
        <p className="text-sm text-ink-2">没有还能接入的机器。守护进程连上之后会出现在这里。</p>
      ) : (
        <ul className="divide-y divide-line">
          {machines.map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span>{m.name}<span className="ml-2 text-ink-2">{m.online ? "在线" : "离线"}</span></span>
              <Button size="sm" loading={busy === m.id} disabled={busy !== null} onClick={() => void link(m.id)}>接入</Button>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  );
}

const START_CMD = `git clone https://github.com/i1mT/loop.git && cd loop
pnpm install
# 在 ~/.config/loop/loop.env 里写入网关地址和守护进程令牌后：
LOOPD_MACHINE_ID=home-mac scripts/start-daemon.sh`;

export default function MachinesPage() {
  const { data, error, loading, reload } = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 10000 });
  const status = useApi<{ machineId: string | null }>("/api/status");
  const localId = status.data?.machineId ?? null;
  const [adding, setAdding] = useState(false);
  const [linking, setLinking] = useState(false);
  const spaces = useApi<{ super?: boolean; available: { id: string; name: string; online: boolean }[] }>("/api/spaces");
  const list = (data?.machines ?? []).slice().sort((a, b) => Number(b.id === localId) - Number(a.id === localId) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="机器"
        description="每台运行了守护进程的电脑。它会自动探测本机装了哪些智能体，项目再绑定到某台机器上的某个智能体。"
        actions={
          <>
            {spaces.data?.super && (
              <Button onClick={() => setLinking(true)}>接入到当前空间</Button>
            )}
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              添加机器
            </Button>
          </>
        }
      />
      <LinkMachineDialog open={linking} machines={spaces.data?.available ?? []} onOpenChange={setLinking} />
      <Dialog open={adding} onOpenChange={setAdding} wide title="添加一台机器" description="在要执行任务的电脑上启动守护进程，几十秒内它就会出现在这里。">
        <div className="grid gap-3 text-sm">
          <ol className="grid list-decimal gap-1 pl-5 text-ink-2">
            <li>电脑上需要 Node 22+、git、GitHub CLI（gh，已登录），以及至少一个智能体（claude、codex、grok、opencode、pi 或 dsh）。</li>
            <li>每台机器用不同的机器 ID（LOOPD_MACHINE_ID），例如 home-mac、office-pc。</li>
            <li>启动后守护进程每分钟与网关同步一次，并上报本机的智能体。</li>
          </ol>
          <CopyBlock text={START_CMD} />
          <p className="text-xs text-ink-2">同一台机器上的任务用 git worktree 隔离；跨机器靠 GitHub 同步代码。</p>
        </div>
      </Dialog>

      {localId && !loading && !list.some((m) => m.id === localId) && (
        <p role="status" className="mb-3 rounded-card border border-warn/30 bg-warn-soft px-4 py-3 text-[13px] text-warn">
          本机（{localId}）还没有在云端注册。先在这台电脑上启动守护进程：<span className="num">scripts/start-daemon.sh</span>。
        </p>
      )}
      {loading ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-44" />
          <Skeleton className="h-44" />
        </div>
      ) : error && !data ? (
        <Card>
          <ErrorState message={error.message} onRetry={reload} />
        </Card>
      ) : list.length === 0 ? (
        <Card>
          <EmptyState
            icon={<MonitorSmartphone className="size-5" aria-hidden />}
            title="还没有机器上线"
            action={
              <Button variant="primary" onClick={() => setAdding(true)}>
                如何添加机器
              </Button>
            }
          >
            守护进程启动后会自动出现在这里。
          </EmptyState>
        </Card>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {list.map((m) => (
            <Card key={m.id} className="p-4">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className={clsx("size-2 shrink-0 rounded-full", m.online ? "bg-ok" : "bg-ink-3")} aria-hidden />
                    <h2 className="truncate text-[15px] font-semibold"><Link href={`/machines/${m.id}`} className="hover:underline">{m.name}</Link></h2>
                    {m.id === localId && <Chip className="border-ink text-ink">本机</Chip>}
                  </div>
                  <p className="num mt-0.5 truncate text-xs text-ink-2">
                    {m.id}
                    {m.os ? ` · ${m.os}` : ""}
                    {m.version ? ` · loopd ${m.version}` : ""}
                  </p>
                </div>
                <Chip className={m.online ? "border-ok/30 text-ok" : ""}>{m.online ? "在线" : `离线 · ${timeAgo(m.lastSeen)}`}</Chip>
              </div>
              <ul className="mt-4 grid gap-1.5">
                {m.agents.length === 0 && <li className="text-[13px] text-ink-2">尚未上报智能体</li>}
                {m.agents.map((a) => {
                  const usable = a.installed && a.acp;
                  return (
                    <li key={a.kind} className="flex items-center gap-2 text-[13px]">
                      {usable ? <Check className="size-4 text-ok" aria-label="可用" /> : <X className="size-4 text-ink-3" aria-label="不可用" />}
                      <Link href={`/machines/${m.id}/agents/${a.kind}`} className={clsx("hover:underline", usable ? "font-medium" : "text-ink-2")}><AgentName kind={a.kind} /></Link>
                      {a.version && <span className="num text-xs text-ink-3">{a.version}</span>}
                      {usable && (a.defaultModel || a.defaultEffort) && <span className="truncate text-xs text-ink-3">· {[a.defaultModel, a.defaultEffort].filter(Boolean).join(" · ")}</span>}
                      {!usable && <span className="ml-auto truncate text-xs text-ink-2">{a.note ?? (a.installed ? "暂不能被驱动" : "未安装")}</span>}
                    </li>
                  );
                })}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
