"use client";
import { CopyBlock } from "@/components/ui/copy-block.tsx";
import { useApi } from "@/lib/client-api.ts";
import type { MachineItem } from "@/lib/types.ts";

const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

export function DaemonUpdatePanel({ machine }: { machine: MachineItem }) {
  const missingCapabilities = !!machine.missingCapabilities?.length;
  const required = !!machine.updateVersion || missingCapabilities;
  const { data } = useApi<{ base: string }>(required ? "/api/status" : null);
  if (!required) return null;

  return <section id="daemon-update" className="mb-4 scroll-mt-4 rounded-control border border-warn/25 bg-warn-soft p-4 text-[13px]" aria-label="守护进程更新">
    <h2 className="font-semibold text-warn">守护进程需要更新</h2>
    {machine.updateVersion && <p className="mt-1 text-ink-2">当前版本 <span className="num">{machine.version}</span>，网关推荐 <span className="num">{machine.updateVersion}</span>。</p>}
    {missingCapabilities && <p className="mt-1 text-ink-2">升级后，这台机器可以领取需要新版功能的任务。</p>}
    <p className="mt-1 text-ink-2">请在机器空闲时更新。机器身份和会话记录会保留。</p>
    {machine.owned ? <div className="mt-3 grid gap-2">
      {data?.base && <>
        <p>通过安装命令接入的机器，在原电脑上运行：</p>
        <CopyBlock text={`curl -fsSL ${quote(`${data.base}/install.sh`)} | sh -s -- --gateway ${quote(data.base)} --update`} />
      </>}
      <p>从源码启动的机器，更新 Loop 仓库、安装依赖后，用原配置重启 daemon。</p>
    </div> : <p className="mt-2">请联系机器所有者更新。</p>}
  </section>;
}
