"use client";
import clsx from "clsx";
import { Check } from "lucide-react";
import { useState } from "react";
import { Button, LinkButton } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input, Textarea } from "@/components/ui/field.tsx";
import { InlineError, Skeleton } from "@/components/ui/states.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPost, mutate, useApi } from "@/lib/client-api.ts";
import { AGENT_LABEL } from "@/lib/status.ts";
import { agentUsable, type MachineItem, type ProjectItem } from "@/lib/types.ts";

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** 两步向导：1 仓库信息；2 选机器与智能体（只列出已安装且可被驱动的） */
export function NewProjectDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (v: boolean) => void; onCreated?: (p: ProjectItem) => void }) {
  const machines = useApi<{ machines: MachineItem[] }>(open ? "/api/machines" : null);
  const toast = useToast();
  const [step, setStep] = useState<1 | 2>(1);
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [mainRef, setMainRef] = useState("main");
  const [localPath, setLocalPath] = useState("");
  const [machineId, setMachineId] = useState("");
  const [agent, setAgent] = useState("");
  const [instructions, setInstructions] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const repoOk = REPO_RE.test(repo.trim());
  const list = (machines.data?.machines ?? []).slice().sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  const machine = list.find((m) => m.id === machineId);

  function reset() {
    setStep(1);
    setName("");
    setRepo("");
    setMainRef("main");
    setLocalPath("");
    setMachineId("");
    setAgent("");
    setInstructions("");
    setError(null);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ project: ProjectItem }>("/api/projects", { name: name.trim(), githubRepo: repo.trim(), mainRef: mainRef.trim() || "main", machineId, agent, localPath: localPath.trim() || undefined, instructions: instructions.trim() || undefined });
      mutate("/api/projects");
      toast("ok", `项目“${r.project.name}”已创建`);
      onCreated?.(r.project);
      onOpenChange(false);
      reset();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "创建失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} wide title="新建项目" description={step === 1 ? "第 1 步，共 2 步：仓库与全局指令" : "第 2 步，共 2 步：选择由哪台机器上的哪个智能体来做"}>
      {step === 1 ? (
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            setStep(2);
          }}
        >
          <Field label="项目名称">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus />}</Field>
          <Field label="GitHub 仓库" hint="格式 owner/name。所有改动都在独立分支上完成，并通过 PR 合并进主分支。" error={repo && !repoOk ? "格式应为 owner/name，例如 acme/web-app" : null}>
            {(id) => <Input id={id} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="acme/web-app" spellCheck={false} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="主分支">{(id) => <Input id={id} value={mainRef} onChange={(e) => setMainRef(e.target.value)} />}</Field>
            <Field label="已有检出路径（可选）" hint="该机器上已有的仓库目录，填了就直接在它上面建 worktree">
              {(id) => <Input id={id} value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/path/to/project" spellCheck={false} />}
            </Field>
          </div>
          <Field label="全局指令（可选）" hint="写这个项目的背景、约定和禁区。每个任务开始时都会连同任务内容一起发给智能体，之后可以在项目页修改。">
            {(id) => <Textarea id={id} value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={4} maxLength={8000} placeholder="例如：这是一个 Next.js 项目，用 pnpm；不要改 legacy/ 目录；提交信息用中文。" />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>取消</Button>
            <Button type="submit" variant="primary" disabled={!name.trim() || !repoOk}>
              下一步
            </Button>
          </div>
        </form>
      ) : (
        <div className="grid gap-4">
          {machines.loading ? (
            <div className="grid gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-card border border-line bg-canvas px-4 py-5 text-sm">
              <p className="font-medium">还没有任何机器上线</p>
              <p className="mt-1 text-ink-2">在要执行任务的电脑上启动守护进程，它会自动上报本机可用的智能体。</p>
              <LinkButton href="/machines" className="mt-3">
                查看如何添加机器
              </LinkButton>
            </div>
          ) : (
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-[13px] font-medium">机器与智能体</legend>
              {list.map((m) => {
                const usable = m.agents.filter(agentUsable);
                return (
                  <div key={m.id} className={clsx("rounded-card border p-3", machineId === m.id ? "border-ink bg-canvas/60" : "border-line")}>
                    <div className="flex items-center gap-2 text-sm">
                      <span className={clsx("size-2 rounded-full", m.online ? "bg-ok" : "bg-ink-3")} aria-hidden />
                      <span className="font-medium">{m.name}</span>
                      <span className="text-xs text-ink-2">{m.online ? "在线" : "离线（任务会等它上线后才开始）"}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {usable.length === 0 && <span className="text-xs text-ink-2">这台机器没有可用的智能体</span>}
                      {usable.map((a) => {
                        const on = machineId === m.id && agent === a.kind;
                        return (
                          <button
                            key={a.kind}
                            type="button"
                            aria-pressed={on}
                            onClick={() => {
                              setMachineId(m.id);
                              setAgent(a.kind);
                            }}
                            className={clsx("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-control border px-2.5 text-[13px] transition-colors", on ? "border-ink bg-ink text-card" : "border-line-strong bg-card hover:bg-sunken")}
                          >
                            {on && <Check className="size-3.5" aria-hidden />}
                            {AGENT_LABEL[a.kind] ?? a.kind}
                            {a.version && <span className={clsx("num text-[11px]", on ? "text-card/70" : "text-ink-3")}>{a.version}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </fieldset>
          )}
          {machine && agent && (
            <p className="text-[13px] text-ink-2">
              将绑定到 <b className="text-ink">{machine.name}</b> 上的 <b className="text-ink">{AGENT_LABEL[agent] ?? agent}</b>。之后创建的任务只会由它领取；它的模型与思考程度在“机器”页的智能体里配置。
            </p>
          )}
          {error && <InlineError>{error}</InlineError>}
          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(1)}>
              上一步
            </Button>
            <Button variant="primary" loading={busy} disabled={!machineId || !agent} onClick={submit}>
              创建项目
            </Button>
          </div>
        </div>
      )}
    </Dialog>
  );
}
