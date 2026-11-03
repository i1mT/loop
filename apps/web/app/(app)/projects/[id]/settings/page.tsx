"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { SaveBar } from "@/components/project/save-bar.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input, Select } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, apiPost, mutate } from "@/lib/client-api.ts";
import { agentUsable } from "@/lib/types.ts";
import { AgentSelect } from "@/components/agent/agent-icon.tsx";

/** 项目设置：基本信息，以及“由哪台机器上的哪个智能体来做”。模型与思考程度不在这里，在机器页的智能体里配置。 */
export default function ProjectSettings() {
  const { project, machines } = useProjectCtx();
  const toast = useToast();

  // ---- 基本信息 ----
  const basics = { name: project.name, repo: project.github_repo ?? "", mainRef: project.main_ref, localPath: project.local_path ?? "" };
  const [b, setB] = useState(basics);
  const [bBusy, setBBusy] = useState(false);
  const [bErr, setBErr] = useState<string | null>(null);
  useEffect(() => setB(basics), [basics.name, basics.repo, basics.mainRef, basics.localPath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 智能体绑定 ----
  const [machineId, setMachineId] = useState(project.machine_id ?? "");
  const [agent, setAgent] = useState(project.agent ?? "");
  const [aBusy, setABusy] = useState(false);
  const [aErr, setAErr] = useState<string | null>(null);
  useEffect(() => {
    setMachineId(project.machine_id ?? "");
    setAgent(project.agent ?? "");
  }, [project.machine_id, project.agent]);
  const machine = machines.find((m) => m.id === machineId);
  const usable = (machine?.agents ?? []).filter(agentUsable);

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
            void patch({ name: b.name, githubRepo: b.repo.trim(), mainRef: b.mainRef, localPath: b.localPath.trim() || null }, setBBusy, setBErr, "已保存");
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="项目名称">{(id) => <Input id={id} value={b.name} onChange={(e) => setB({ ...b, name: e.target.value })} />}</Field>
            <Field label="GitHub 仓库">{(id) => <Input id={id} value={b.repo} onChange={(e) => setB({ ...b, repo: e.target.value })} spellCheck={false} />}</Field>
            <Field label="主分支">{(id) => <Input id={id} value={b.mainRef} onChange={(e) => setB({ ...b, mainRef: e.target.value })} />}</Field>
            <Field label="已有检出路径（可选）" hint="该机器上已有的仓库目录，填了就直接在它上面建 worktree">
              {(id) => <Input id={id} value={b.localPath} onChange={(e) => setB({ ...b, localPath: e.target.value })} spellCheck={false} />}
            </Field>
          </div>
          <SaveBar busy={bBusy} dirty={JSON.stringify(b) !== JSON.stringify(basics)} disabled={!b.name.trim()} error={bErr} />
        </form>
      </Card>

      <Card>
        <h2 className="border-b border-line px-4 py-3 text-[15px] font-semibold">机器与智能体</h2>
        <form
          className="grid gap-4 p-4 sm:max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            void patch({ machineId, agent }, setABusy, setAErr, "已保存，之后创建的任务使用新的智能体");
          }}
        >
          <p className="text-[13px] text-ink-2">
            任务由这台机器上的这个智能体执行。它的模型与思考程度在
            <Link href={`/machines/${machineId}/agents/${agent}`} className="mx-1 underline underline-offset-2 hover:text-ink">
              机器页的智能体配置
            </Link>
            里设置。
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="机器">
              {(id) => (
                <Select
                  id={id}
                  value={machineId}
                  onChange={(e) => {
                    setMachineId(e.target.value);
                    setAgent("");
                  }}
                >
                  {machines.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                      {m.online ? "" : "（离线）"}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="智能体" hint={usable.length ? undefined : "这台机器没有可用的智能体"}>
              {(id) => (
                <AgentSelect id={id} value={agent} onChange={setAgent} options={usable.map((a) => ({ value: a.kind }))} />
              )}
            </Field>
          </div>
          <SaveBar busy={aBusy} dirty={machineId !== (project.machine_id ?? "") || agent !== (project.agent ?? "")} disabled={!agent} error={aErr} />
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
              <Button loading={archiveBusy} onClick={() => setArchived(false)}>
                恢复项目
              </Button>
            ) : (
              <Button variant="danger" onClick={() => setConfirmingArchive(true)}>
                归档项目
              </Button>
            )}
          </div>
        </div>
      </Card>

      <Dialog open={confirmingArchive} onOpenChange={setConfirmingArchive} title={`归档“${project.name}”？`} description="归档后不再接收新任务，已有任务不受影响，随时可以恢复。">
        <div className="flex justify-end gap-2">
          <Button onClick={() => setConfirmingArchive(false)}>取消</Button>
          <Button variant="danger" loading={archiveBusy} onClick={() => setArchived(true)}>
            确认归档
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
