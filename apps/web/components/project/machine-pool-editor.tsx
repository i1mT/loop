"use client";
import {ArrowDown,ArrowUp,Plus,Trash2} from "lucide-react";
import type {ReactNode} from "react";
import {Button} from "@/components/ui/button.tsx";
import {Input} from "@/components/ui/field.tsx";
import {Picker} from "@/components/ui/select.tsx";
import {AgentName} from "@/components/agent/agent-icon.tsx";
import {agentUsable,type MachineItem} from "@/lib/types.ts";
import {EFFORTS,EFFORT_LABEL} from "@/lib/status.ts";
import type {ProjectBinding} from "@/lib/routing/bindings.ts";

/** 容器够宽时一行一台机器；窄容器（弹窗、手机）自动堆叠，避免把后面的列裁掉。 */
const ROW_COLS="@min-[800px]:grid-cols-[2rem_minmax(8rem,1fr)_minmax(9rem,1.2fr)_minmax(6.5rem,.7fr)_minmax(8rem,1fr)_minmax(7rem,.8fr)_auto]";

function Cell({label,children}:{label:string;children:ReactNode}){
  return <div className="grid min-w-0 gap-1"><span className="text-[11px] text-ink-2 @min-[800px]:sr-only">{label}</span>{children}</div>;
}

/** 项目绑定的机器列表：一行一台机器，逐台选择机器、仓库目录、智能体，并可覆盖模型与思考程度。 */
export function MachinePoolEditor({value,onChange,machines,restricted=false}:{value:ProjectBinding[];onChange:(value:ProjectBinding[])=>void;machines:MachineItem[];restricted?:boolean}) {
  const available=machines.filter(machine=>!value.some(row=>row.machineId===machine.id)&&machine.agents.some(agentUsable));
  function change(rows:ProjectBinding[]){onChange(rows);}
  function patchRow(index:number,patch:Partial<ProjectBinding>){change(value.map((row,i)=>i===index?{...row,...patch}:row));}
  function move(index:number,delta:number){const rows=value.slice();[rows[index],rows[index+delta]]=[rows[index+delta],rows[index]];change(rows);}
  function addMachine(){
    const machine=available[0];if(!machine)return;
    const agent=machine.agents.find(agentUsable)!;
    change([...value,{machineId:machine.id,localPath:null,agent:agent.kind,model:null,effort:null}]);
  }
  const missingAgent=value.some(row=>!row.agent);
  return <div className="@container grid gap-4">
    <div className="text-[13px] leading-relaxed text-ink-2"><p>优先分配到在线空闲机器；在线机器都忙时，按下面的顺序轮流分配。</p><p>排队任务也计入占用。所有机器离线时，任务会等待所分配的机器上线。</p><p>每台机器可以有自己的智能体；模型与思考程度留空时跟随机器页里该智能体的配置。</p></div>
    {restricted&&<p className="text-sm text-ink-2">这里只显示你有权使用的机器，其他绑定会保留。顺序调整只针对当前可见的机器。</p>}
    <div className="overflow-hidden rounded-control border border-line">
      <div className={`hidden items-center gap-3 border-b border-line bg-canvas/60 px-3 py-2 text-[11px] text-ink-2 @min-[800px]:grid ${ROW_COLS}`}>
        <span>序号</span><span>机器</span><span>项目在机器上的目录</span><span>智能体</span><span>模型</span><span>思考程度</span><span className="text-right">操作</span>
      </div>
      <ol className="divide-y divide-line">
        {value.map((row,index)=>{
          const machine=machines.find(item=>item.id===row.machineId);
          const agentOptions=(machine?.agents??[]).filter(agentUsable);
          const cfg=agentOptions.find(agent=>agent.kind===row.agent);
          const models=cfg?.models??[];
          const effortOptions=(cfg?.efforts?.length?cfg.efforts.map(item=>item.value):[...EFFORTS]);
          const machineChoices=machines.filter(item=>item.id===row.machineId||!value.some(binding=>binding.machineId===item.id));
          return <li key={row.machineId||index} className={`grid gap-3 px-3 py-3 @min-[800px]:items-center @min-[800px]:gap-3 ${ROW_COLS}`}>
            <div className="flex items-center gap-2"><span className="num text-xs text-ink-3">{index+1}</span></div>
            <Cell label="机器"><Picker ariaLabel={`第 ${index+1} 台机器`} value={row.machineId} onChange={id=>{
              const next=machines.find(item=>item.id===id);
              const nextAgent=next?.agents.find(agent=>agentUsable(agent)&&agent.kind===row.agent)??next?.agents.find(agentUsable);
              patchRow(index,{machineId:id,localPath:null,agent:nextAgent?.kind??"",model:null,effort:null});
            }} options={[
              ...(row.machineId&&!machines.some(item=>item.id===row.machineId)?[{value:row.machineId,label:`${row.machineId}（机器不存在）`,disabled:true}]:[]),
              ...machineChoices.map(item=>({value:item.id,label:<span className="inline-flex items-center gap-1.5"><span className={`size-1.5 rounded-full ${item.online?"bg-ok":"bg-ink-3"}`} aria-hidden/>{item.online&&<span className="sr-only">在线</span>}{item.name}{item.online?null:"（离线）"}</span>,disabled:!item.agents.some(agentUsable)})),
            ]}/></Cell>
            <Cell label="项目在机器上的目录"><Input aria-label={`第 ${index+1} 台机器的仓库目录`} value={row.localPath??""} onChange={event=>patchRow(index,{localPath:event.target.value})} placeholder="留空自动下载" spellCheck={false}/></Cell>
            <Cell label="智能体">{!row.machineId?<Input value="" disabled placeholder="先选择机器"/>:!agentOptions.length&&!row.agent?<Input value="" disabled placeholder="这台机器没有可用智能体"/>:<Picker ariaLabel={`第 ${index+1} 台机器的智能体`} value={row.agent} placeholder="选择智能体" onChange={kind=>patchRow(index,{agent:kind,model:null,effort:null})} options={[
              ...agentOptions.map(agent=>({value:agent.kind,label:<AgentName kind={agent.kind} size={14}/>})),
              ...(row.agent&&!agentOptions.some(agent=>agent.kind===row.agent)?[{value:row.agent,label:<span>{row.agent}（不可用）</span>,disabled:true}]:[]),
            ]}/>}</Cell>
            <Cell label="模型">{!row.agent?<Input value="" disabled placeholder="先选智能体"/>:models.length?<Picker ariaLabel={`第 ${index+1} 台机器的模型`} value={row.model||"__machine"} onChange={model=>patchRow(index,{model:model==="__machine"?null:model})} options={[
              {value:"__machine",label:`默认 · ${cfg?.defaultModel||"智能体默认"}`},
              ...models.map(option=>({value:option.value,label:option.name})),
              ...(row.model&&!models.some(option=>option.value===row.model)?[{value:row.model,label:`${row.model}（不在列表）`}]:[]),
            ]}/>:<Input aria-label={`第 ${index+1} 台机器的模型`} value={row.model??""} onChange={event=>patchRow(index,{model:event.target.value})} placeholder={cfg?.defaultModel?`默认 ${cfg.defaultModel}`:"智能体默认"} spellCheck={false}/>}</Cell>
            <Cell label="思考程度">{!row.agent?<Input value="" disabled placeholder="先选智能体"/>:<Picker ariaLabel={`第 ${index+1} 台机器的思考程度`} value={row.effort||"__machine"} onChange={effort=>patchRow(index,{effort:effort==="__machine"?null:effort})} options={[
              {value:"__machine",label:`默认 · ${cfg?.defaultEffort?(EFFORT_LABEL[cfg.defaultEffort]??cfg.defaultEffort):"智能体默认"}`},
              ...effortOptions.map(effort=>({value:effort,label:`${EFFORT_LABEL[effort]??effort}（${effort}）`})),
              ...(row.effort&&!effortOptions.includes(row.effort)?[{value:row.effort,label:`${row.effort}（不在列表）`}]:[]),
            ]}/>}</Cell>
            <div className="flex items-center gap-1 @min-[800px]:justify-end">
              <Button size="sm" variant="ghost" aria-label={`上移第 ${index+1} 台机器`} disabled={index===0} onClick={()=>move(index,-1)}><ArrowUp className="size-4"/></Button>
              <Button size="sm" variant="ghost" aria-label={`下移第 ${index+1} 台机器`} disabled={index===value.length-1} onClick={()=>move(index,1)}><ArrowDown className="size-4"/></Button>
              <Button size="sm" variant="ghost" aria-label={`移除第 ${index+1} 台机器`} onClick={()=>change(value.filter((_,i)=>i!==index))}><Trash2 className="size-4"/></Button>
            </div>
          </li>;
        })}
      </ol>
    </div>
    <div><Button type="button" disabled={!available.length} onClick={addMachine}><Plus className="size-4"/>添加机器</Button></div>
    {missingAgent&&<p role="alert" className="text-sm text-bad">还有机器没有选择智能体。</p>}
  </div>;
}
