"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { apiDelete, apiPatch, mutate, useApi } from "@/lib/client-api.ts";
import { useToast } from "@/components/ui/toast.tsx";
import type { MachineItem } from "@/lib/types.ts";
import { ConnectMachineDialog } from "./connect-dialog.tsx";

export function MachineAccessPanel({ machine }: { machine: MachineItem }) {
  const [action,setAction] = useState<"share"|"private"|"disconnect"|null>(null);
  const [connecting,setConnecting] = useState(false);
  const [busy,setBusy] = useState(false);
  const toast=useToast();
  const spaces=useApi<{spaces:{id:string;name:string}[];current:string}>("/api/spaces");
  const spaceName=spaces.data?.spaces.find(space=>space.id===spaces.data?.current)?.name ?? "当前空间";
  if (!machine.owned) return <p className="mb-6 text-sm text-ink-2">这台机器由空间成员共享。你可以运行任务，机器配置由所有者管理。</p>;
  async function save() {
    setBusy(true);
    try {
      if (action==="disconnect") await apiDelete(`/api/machines/${machine.id}/credential`);
      else await apiPatch(`/api/machines/${machine.id}`,{shared:action==="share"});
      mutate("/api/machines");toast("ok",action==="disconnect" ? "已断开连接，旧凭证不能继续使用" : "使用权限已经更新");setAction(null);
    } catch(e) {toast("error",e instanceof Error ? e.message : "暂时无法修改，请重试");}
    finally {setBusy(false);}
  }
  return <>
    <h2 className="mb-2 text-[15px] font-semibold">使用权限</h2>
    <Card className="mb-6 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><p className="text-sm font-medium">{machine.shared ? `已共享给「${spaceName}」` : "未向当前空间共享"}</p><p className="mt-1 text-[13px] text-ink-2">{machine.shared ? "空间成员可以使用这台机器；只有你可以修改智能体配置和连接凭证。" : "当前空间的其他成员无法使用这台机器。这项设置只影响当前空间。"}</p></div>
        <Button onClick={()=>setAction(machine.shared ? "private" : "share")}>{machine.shared ? "取消空间共享" : "共享给当前空间"}</Button>
      </div>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4"><Button onClick={()=>setConnecting(true)}>重新连接</Button><Button variant="danger" onClick={()=>setAction("disconnect")}>断开连接</Button></div>
      {machine.legacyAuth && <p className="mt-2 text-xs text-ink-2">这台机器正在使用旧连接方式，重新连接后会使用独立凭证，已有项目和会话仍然保留。</p>}
    </Card>
    <ConnectMachineDialog open={connecting} onOpenChange={setConnecting} machineId={machine.id} />
    <Dialog open={action!==null} onOpenChange={open=>{if(!open)setAction(null);}} title={action==="share" ? `共享给「${spaceName}」？` : action==="private" ? "取消空间共享？" : "断开这台机器的连接？"} description={action==="share" ? "这个空间的成员将可以通过机器运行项目任务。请确认你信任这些成员以及项目中的指令。" : action==="private" ? "当前空间的其他成员将无法使用这台机器，也无法操作对应的项目和任务。已有任务和你配置的外部反馈接入仍会继续处理。" : "旧凭证将立即失效，机器将停止接收和回传任务。电脑上的文件和会话记录会保留；之后可以重新连接。"}>
      <div className="flex justify-end gap-2"><Button onClick={()=>setAction(null)}>取消</Button><Button variant={action==="share" ? "primary" : "danger"} loading={busy} onClick={()=>void save()}>确认{action==="share" ? "共享" : action==="private" ? "取消共享" : "断开"}</Button></div>
    </Dialog>
  </>;
}
