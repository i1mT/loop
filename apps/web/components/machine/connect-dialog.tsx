"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { apiPost, useApi } from "@/lib/client-api.ts";

interface Pairing { code: string; machineId: string; expiresAt: number }
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function ConnectMachineDialog({ open, onOpenChange, machineId }: { open: boolean; onOpenChange: (open: boolean) => void; machineId?: string }) {
  const releases = useApi<Record<string,{file:string}>>(open ? "/api/daemon-releases/manifest.json" : null,{poll:10000});
  const releaseReady = ["darwin-arm64","darwin-x64","linux-arm64","linux-x64"].every(target=>releases.data?.[target]?.file);
  const status = useApi<{ base: string }>("/api/status");
  const [name,setName] = useState("我的电脑");
  const [pairing,setPairing] = useState<Pairing | null>(null);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<string | null>(null);
  const base = status.data?.base;
  function close(value: boolean) {onOpenChange(value);if(!value){setPairing(null);setError(null);}}
  async function generate() {
    setBusy(true);setError(null);
    try { setPairing(await apiPost<Pairing>(machineId ? `/api/machines/${encodeURIComponent(machineId)}/credential` : "/api/machines/pairings", { name })); }
    catch (e) {setError(e instanceof Error ? e.message : "暂时无法生成连接命令，请重试");}
    finally {setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={close} wide title={machineId ? "重新连接机器" : "添加我的机器"} description="连接后默认只有你可以使用；你可以稍后分享给当前空间。">
    <div className="grid gap-4 text-sm">
      {!machineId && <Field label="机器名称">{id=><Input id={id} value={name} maxLength={80} onChange={e=>setName(e.target.value)} />}</Field>}
      <p className="text-ink-2">在要运行任务的电脑上打开终端，执行下面的命令。安装会自动完成，并在后台启动。</p>
      <p className="text-xs text-ink-2">运行任务前，请先准备 Git、已登录的代码托管工具与智能体。Windows 需要在 WSL2 中安装。</p>
      {machineId && <p className="rounded-control bg-warn-soft p-3 text-warn">请先在原电脑执行 <code>~/.local/bin/loopd stop</code>，等待停止后再连接。保留原有数据目录，才能继续已有会话。新连接成功后，旧凭证立即失效。</p>}
      {pairing && base ? <>
        <CopyBlock text={`curl -fsSL ${quote(`${base}/install.sh`)} | sh -s -- --gateway ${quote(base)} --code ${quote(pairing.code)}`} />
        <p className="text-xs text-ink-2">连接码在 {new Date(pairing.expiresAt).toLocaleTimeString("zh-CN",{hour:"2-digit",minute:"2-digit"})} 之前有效，只能使用一次。不要把这条命令发给其他人。</p>
        <p role="status" className="text-ink-2">执行完成后关闭窗口，稍等片刻即可在列表中看到在线机器。</p>
      </> : <Button variant="primary" disabled={!base || !name.trim() || !releaseReady} loading={busy} onClick={()=>void generate()}>生成安装命令</Button>}
      {!releaseReady && <p role="status" className="text-ink-2">{releases.error ? "安装包暂时无法下载，请稍后重试。" : "正在检查可用的安装包……"}</p>}
      {error && <p role="alert" className="text-bad">{error}</p>}
      <p className="text-xs leading-relaxed text-ink-2">支持 macOS（Apple 芯片、Intel）与 Linux（ARM64、x64）；不需要克隆仓库或安装 Node。</p>
      {pairing && <div className="flex justify-end gap-2"><Button loading={busy} onClick={()=>void generate()}>重新生成</Button><Button variant="primary" onClick={()=>close(false)}>完成</Button></div>}
    </div>
  </Dialog>;
}
