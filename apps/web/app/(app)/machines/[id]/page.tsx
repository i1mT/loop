"use client";
import clsx from "clsx";
import { Check, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { use, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { Chip } from "@/components/ui/badge.tsx";
import { Card, PageHeader } from "@/components/ui/page-header.tsx";
import { EmptyState, ErrorState, Skeleton } from "@/components/ui/states.tsx";
import { ApiError, apiDelete, mutate, useApi } from "@/lib/client-api.ts";
import { timeAgo } from "@/lib/format.ts";
import { EFFORT_LABEL } from "@/lib/status.ts";
import type { MachineItem, ProjectItem } from "@/lib/types.ts";
import { AgentName } from "@/components/agent/agent-icon.tsx";

/** 机器详情：机器信息、上面的智能体（点进去配置模型）、绑定到这台机器的项目 */
export default function MachinePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const machines = useApi<{ machines: MachineItem[] }>("/api/machines", { poll: 10000 });
  const projects = useApi<{ projects: ProjectItem[] }>("/api/projects");
  const status = useApi<{ machineId: string | null }>("/api/status");
  const m = machines.data?.machines.find((x) => x.id === id);
  const router = useRouter();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const mine = (projects.data?.projects ?? []).filter((p) => p.machine_id === id);

  if (machines.error && !machines.data) return <ErrorState message={machines.error.message} onRetry={machines.reload} />;
  if (machines.loading)
    return (
      <div role="status" aria-label="加载中" className="grid gap-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48" />
      </div>
    );
  if (!m)
    return (
      <Card>
        <EmptyState title="没有找到这台机器">它可能从未注册过。</EmptyState>
      </Card>
    );

  return (
    <>
      <PageHeader
        crumbs={
          <Link href="/machines" className="hover:text-ink hover:underline">
            机器
          </Link>
        }
        title={
          <span className="flex items-center gap-2">
            <span className={clsx("size-2.5 rounded-full", m.online ? "bg-ok" : "bg-ink-3")} aria-hidden />
            {m.name}
            {status.data?.machineId === m.id && <Chip className="border-ink text-ink">本机</Chip>}
          </span>
        }
        description={
          <span className="num text-xs">
            {m.id}
            {m.os ? ` · ${m.os}` : ""}
            {m.version ? ` · loopd ${m.version}` : ""} · {m.online ? "在线" : `离线，${timeAgo(m.lastSeen)}`}
          </span>
        }
      />

      <h2 className="mb-2 text-[15px] font-semibold">智能体</h2>
      <Card className="mb-6 overflow-hidden">
        {m.agents.length === 0 ? (
          <EmptyState title="尚未上报智能体">守护进程启动后会自动探测本机装了哪些智能体。</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {m.agents.map((a) => {
              const usable = a.installed && a.acp;
              const cfg = [a.defaultModel, a.defaultEffort ? `思考${EFFORT_LABEL[a.defaultEffort] ?? a.defaultEffort}` : null].filter(Boolean).join(" · ");
              return (
                <li key={a.kind}>
                  <Link href={`/machines/${m.id}/agents/${a.kind}`} className="flex items-center gap-3 px-4 py-3 hover:bg-canvas/60">
                    {usable ? <Check className="size-4 shrink-0 text-ok" aria-label="可用" /> : <X className="size-4 shrink-0 text-ink-3" aria-label="不可用" />}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className={usable ? "font-medium" : "text-ink-2"}><AgentName kind={a.kind} /></span>
                        {a.version && <span className="num text-xs text-ink-3">{a.version}</span>}
                      </div>
                      <div className="mt-0.5 text-xs text-ink-2">{usable ? (cfg || "使用智能体默认的模型与思考程度") : (a.note ?? (a.installed ? "暂不能被驱动" : "未安装"))}</div>
                    </div>
                    {usable && a.models.length > 0 && <span className="hidden text-xs text-ink-3 sm:block">{a.models.length} 个模型</span>}
                    <ChevronRight className="size-4 shrink-0 text-ink-3" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 text-[15px] font-semibold">绑定到这台机器的项目</h2>
      <Card className="overflow-hidden">
        {mine.length === 0 ? (
          <EmptyState title="还没有项目绑定到这台机器">在项目的“设置”里选择机器和智能体。</EmptyState>
        ) : (
          <ul className="divide-y divide-line">
            {mine.map((p) => (
              <li key={p.id}>
                <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-canvas/60">
                  <span>
                    {p.name} <span className="num text-xs text-ink-2">{p.github_repo}</span>
                  </span>
                  <span className="text-xs text-ink-2"><AgentName kind={p.agent} size={14} /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <h2 className="mb-2 mt-6 text-[15px] font-semibold">删除机器</h2>
      <Card className="p-4">
        <p className="text-[13px] text-ink-2">
          只是删除这台机器在 Loop 里的登记（智能体清单等），不会动机器上的任何文件。仅当它离线、没有项目绑定、没有未结束的任务时才能删除；守护进程如果还在运行，下次连接会重新登记。
        </p>
        <div className="mt-3">
          <Button
            variant="danger"
            disabled={m.online || mine.length > 0}
            title={m.online ? "机器在线，请先停掉它的守护进程" : mine.length > 0 ? "还有项目绑定在这台机器上" : undefined}
            onClick={() => setConfirming(true)}
          >
            删除这台机器
          </Button>
          {m.online && <p className="mt-2 text-xs text-ink-3">机器在线，不能删除。先停掉它的守护进程。</p>}
          {!m.online && mine.length > 0 && <p className="mt-2 text-xs text-ink-3">还有 {mine.length} 个项目绑定在这台机器上，先在项目设置里换一台机器。</p>}
        </div>
      </Card>

      <Dialog open={confirming} onOpenChange={setConfirming} title={`删除“${m.name}”？`} description="只删除登记，不会动机器上的文件。守护进程之后再连接会重新登记。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirming(false)}>取消</Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await apiDelete(`/api/machines/${encodeURIComponent(m.id)}`);
                mutate("/api/machines");
                toast("ok", "已删除");
                router.push("/machines");
              } catch (e) {
                toast("error", e instanceof ApiError ? e.message : "删除失败");
                setConfirming(false);
              } finally {
                setBusy(false);
              }
            }}
          >
            确认删除
          </Button>
        </div>
      </Dialog>
    </>
  );
}
