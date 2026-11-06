"use client";
import {useState} from "react";
import {Button,LinkButton} from "@/components/ui/button.tsx";
import {Dialog} from "@/components/ui/dialog.tsx";
import {Field,Input,Textarea} from "@/components/ui/field.tsx";
import {ErrorState,InlineError,Skeleton} from "@/components/ui/states.tsx";
import {useToast} from "@/components/ui/toast.tsx";
import {ApiError,apiPost,mutate,useApi} from "@/lib/client-api.ts";
import type {MachineItem,ProjectItem} from "@/lib/types.ts";
import type {ProjectBinding} from "@/lib/routing/bindings.ts";
import {MachinePoolEditor} from "@/components/project/machine-pool-editor.tsx";
const REPO_RE=/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export function NewProjectDialog({open,onOpenChange,onCreated}:{open:boolean;onOpenChange:(value:boolean)=>void;onCreated?:(project:ProjectItem)=>void}){
 const machines=useApi<{machines:MachineItem[]}>(open?"/api/machines":null);const toast=useToast();
 const [step,setStep]=useState(1),[name,setName]=useState(""),[repo,setRepo]=useState(""),[mainRef,setMainRef]=useState("main"),[instructions,setInstructions]=useState("");
 const [bindings,setBindings]=useState<ProjectBinding[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null);
 function close(value:boolean){onOpenChange(value);if(!value){setStep(1);setName("");setRepo("");setMainRef("main");setInstructions("");setBindings([]);setError(null);}}
 async function submit(){setBusy(true);setError(null);try{
   const result=await apiPost<{project:ProjectItem}>("/api/projects",{name:name.trim(),githubRepo:repo.trim(),mainRef:mainRef.trim()||"main",instructions:instructions.trim(),bindings});
   mutate("/api/projects");toast("ok",`项目“${result.project.name}”已创建`);onCreated?.(result.project);close(false);
 }catch(e){setError(e instanceof ApiError?e.message:"创建失败，请重试");}finally{setBusy(false);}}
 const list=machines.data?.machines??[];const valid=bindings.length>0&&bindings.every(row=>!!row.machineId&&!!row.agent);
 return <Dialog open={open} onOpenChange={close} wider title="新建项目" description={step===1?"第 1 步，共 2 步：仓库与全局指令":"第 2 步，共 2 步：配置机器与分配顺序"}>
 {step===1?<form className="grid gap-4" onSubmit={event=>{event.preventDefault();setStep(2);}}>
   <Field label="项目名称">{id=><Input id={id} value={name} onChange={event=>setName(event.target.value)} maxLength={80} autoFocus/>}</Field>
   <Field label="GitHub 仓库" hint="格式 owner/name。改动通过独立分支和 PR 合并。">{id=><Input id={id} value={repo} onChange={event=>setRepo(event.target.value)} placeholder="acme/site" spellCheck={false}/>}</Field>
   <Field label="主分支">{id=><Input id={id} value={mainRef} onChange={event=>setMainRef(event.target.value)}/>}</Field>
   <Field label="全局指令（可选）">{id=><Textarea id={id} value={instructions} onChange={event=>setInstructions(event.target.value)} rows={4} maxLength={8000}/>}</Field>
   <div className="flex justify-end gap-2"><Button onClick={()=>close(false)}>取消</Button><Button type="submit" variant="primary" disabled={!name.trim()||!REPO_RE.test(repo.trim())}>下一步</Button></div>
 </form>:<div className="grid gap-4">
   {machines.loading?<Skeleton className="h-48"/>:machines.error&&!machines.data?<ErrorState message={machines.error.message} onRetry={machines.reload}/>:!list.length?<div className="grid gap-3 text-sm"><p>还没有可用的机器，请先连接自己的电脑。</p><LinkButton href="/machines">添加我的机器</LinkButton></div>:<MachinePoolEditor value={bindings} onChange={setBindings} machines={list}/>}
   {error&&<InlineError>{error}</InlineError>}
   <div className="flex justify-between gap-2"><Button variant="ghost" onClick={()=>setStep(1)}>上一步</Button><Button variant="primary" loading={busy} disabled={!valid} onClick={()=>void submit()}>创建项目</Button></div>
 </div>}
 </Dialog>;
}
