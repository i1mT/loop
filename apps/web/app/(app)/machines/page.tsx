"use client";
import { ConnectMachineDialog } from "@/components/machine/connect-dialog.tsx";
import clsx from "clsx";
import { Check, MonitorSmartphone, Plus, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Chip } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import type { MachineItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

export default function MachinesPage() {
  const { data, error, loading, reload } = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 10000 });
  const status = useApi<{ machineId: string | null }>("/api/status");
  const localId = status.data?.machineId ?? null;
  const [adding, setAdding] = useState(false);
  const list = (data?.machines ?? []).slice().sort((a, b) => Number(b.id === localId) - Number(a.id === localId) || Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title="机器"
        description="管理自己的电脑，以及当前空间共享给你的电脑。新连接的机器默认仅自己使用。"
        actions={
          <>
            <Button onClick={() => setAdding(true)}>
              <Plus className="size-4" aria-hidden />
              添加机器
            </Button>
          </>
        }
      />
      <ConnectMachineDialog open={adding} onOpenChange={setAdding} />

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
                    <Chip>{m.owned ? (m.shared ? "我的 · 空间共享" : "我的 · 未在此共享") : "空间共享"}</Chip>
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
