"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SaveBar } from "@/components/project/save-bar.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, apiPost, mutate } from "@/lib/client-api.ts";
import { projectBindings } from "@/lib/routing/view.ts";
import { MachinePoolEditor } from "@/components/project/machine-pool-editor.tsx";


/** 项目设置：基本信息，以及每台机器用哪个智能体、模型与思考程度。 */
export default function ProjectSettings() {
  const { project, machines } = useProjectCtx();
  const toast = useToast();
  const canManage=project.canManage!==false;

  // ---- 基本信息 ----
  const basics = { name: project.name, repo: project.github_repo ?? "", mainRef: project.main_ref };
  const [b, setB] = useState(basics);
  const [bBusy, setBBusy] = useState(false);
  const [bErr, setBErr] = useState<string | null>(null);
  useEffect(() => setB(basics), [basics.name, basics.repo, basics.mainRef]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 机器与智能体绑定 ----
  const initialBindings=projectBindings(project);
  const [bindings,setBindings]=useState(initialBindings);
  const [aBusy,setABusy]=useState(false),[aErr,setAErr]=useState<string|null>(null);
  const bindingKey=JSON.stringify(initialBindings);
  useEffect(()=>{setBindings(JSON.parse(bindingKey));},[bindingKey]);
  const validBindings=bindings.length>0&&bindings.every(row=>!!row.machineId&&!!row.agent);

  // ---- 归档 ----
  const [confirmingArchive, setConfirmingArchive] = useState(false);
  const [archiveBusy, setArchiveBusy] = useState(false);
  const archived = !!project.archived_at;
  async function setArchived(next: boolean) {
    setArchiveBusy(true);
    try {
      await apiPost(`/api/projects/${project.id}/archive`, { archived: next });
      mutate("/api/projects");
      toast("ok", next ? "项目已归档" : "项目已恢复");
      setConfirmingArchive(false);
    } catch (err) {
      toast("error", err instanceof ApiError ? err.message : "操作失败");
    } finally {
      setArchiveBusy(false);
    }
  }

  async function patch(body: Record<string, unknown>, setBusy: (v: boolean) => void, setErr: (v: string | null) => void, ok: string) {
    setBusy(true);
    setErr(null);
    try {
      await apiPatch(`/api/projects/${project.id}`, body);
      mutate("/api/projects");
      toast("ok", ok);
    } catch (err) {
      setErr(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">基本信息</h2>
        <form
          className="grid gap-4 p-4 sm:max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ name: b.name, githubRepo: b.repo.trim(), mainRef: b.mainRef }, setBBusy, setBErr, "已保存");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {!canManage&&<p className="text-sm text-ink-2 sm:col-span-2">公共配置由拥有全部机器使用权限的成员管理。你可以调整下方有权使用的机器绑定；其他绑定会保留。</p>}
            <Field label="项目名称">{(id) => <Input disabled={!canManage} id={id} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />}</Field>
            <Field label="GitHub 仓库">{(id) => <Input disabled={!canManage} id={id} value={b.repo} onChange={(e) => setB({ ...b, repo: e.target.value })} spellCheck={false} />}</Field>
            <Field label="主分支">{(id) => <Input disabled={!canManage} id={id} value={b.mainRef} onChange={(e) => setB({ ...b, mainRef: e.target.value })} />}</Field>

          </div>
          <SaveBar busy={bBusy} dirty={JSON.stringify(b) !== JSON.stringify(basics)} disabled={!b.name.trim()||!canManage} error={bErr} />
        </form>
      </Card>

      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">机器与智能体</h2>
        <form
          className="grid gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ bindings }, setABusy, setAErr, "分配设置已保存，之后创建的任务使用新规则");
          }}
        >
          <MachinePoolEditor value={bindings} onChange={setBindings} machines={machines} restricted={!canManage}/>
          <SaveBar busy={aBusy} dirty={JSON.stringify(bindings)!==bindingKey} disabled={!validBindings} error={aErr}/>

        </form>
      </Card>

      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">{archived ? "已归档" : "归档项目"}</h2>
        <div className="grid gap-3 p-4 sm:max-w-2xl">
          <p className="text-[13px] text-ink-2">
            {archived
              ? "这个项目已归档：不再接收新任务（手动创建、SDK 与 API 都会被拒绝），已有任务不受影响。恢复后一切照旧。"
              : "归档后项目从默认列表隐藏，并且不再接收新任务（手动创建、SDK 与 API 都会被拒绝）；进行中的任务会继续完成，数据全部保留，随时可以恢复。"}
          </p>
          <div>
            {archived ? (
              <Button loading={archiveBusy} disabled={!canManage} onClick={() => setArchived(false)}>
                恢复项目
              </Button>
            ) : (
              <Button disabled={!canManage} variant="danger" onClick={() => setConfirmingArchive(true)}>
                归档项目
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Dialog open={confirmingArchive} onOpenChange={setConfirmingArchive} title={`归档“${project.name}”？`} description="归档后不再接收新任务，已有任务不受影响，随时可以恢复。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmingArchive(false)}>取消</Button>
          <Button variant="danger" loading={archiveBusy} disabled={!canManage} onClick={() => setArchived(true)}>
            确认归档
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
