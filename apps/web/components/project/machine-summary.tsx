"use client";
import Link from "next/link";
import {projectBindings} from "@/lib/routing/view.ts";
import {EFFORT_LABEL} from "@/lib/status.ts";
import type {MachineItem,ProjectItem} from "@/lib/types.ts";
import {AgentName} from "@/components/agent/agent-icon.tsx";
export function MachineSummary({project,machines,detailed=false}:{project:ProjectItem;machines:MachineItem[];detailed?:boolean}){
 const bindings=projectBindings(project);
 if(!detailed)return <span title={bindings.map(row=>machines.find(machine=>machine.id===row.machineId)?.name??row.machineId).join("、")}>{bindings.length} 台机器 · 空闲优先</span>;
 return <div className="grid gap-2"><ol className="grid gap-3">{bindings.map((row,index)=>{
  const machine=machines.find(item=>item.id===row.machineId),config=machine?.agents.find(agent=>agent.kind===row.agent);
  const model=row.model||config?.defaultModel;
  const effort=row.effort||config?.defaultEffort;
  return <li key={row.machineId} className="text-sm"><div className="flex flex-wrap items-center gap-2"><span className="num text-xs text-ink-3">{index+1}</span><Link href={`/machines/${row.machineId}`} className="hover:underline">{machine?.name??row.machineId}</Link><span className="text-xs text-ink-2">{machine?.online?"在线":"离线"}</span><Link href={`/machines/${row.machineId}/agents/${row.agent}`} className="text-ink-2 hover:underline"><AgentName kind={row.agent} size={14}/></Link></div><p className="mt-1 text-xs text-ink-2">{[model,effort?`思考${EFFORT_LABEL[effort]??effort}`:null].filter(Boolean).join(" · ")||"智能体默认配置"}</p>{row.localPath&&<p className="num mt-1 break-all text-xs text-ink-3">{row.localPath}</p>}</li>;
 })}</ol><p className="text-xs text-ink-2">在线空闲优先；都忙时按顺序轮流分配。</p></div>;
}
