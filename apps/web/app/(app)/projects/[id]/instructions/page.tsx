"use client";
import { useEffect, useState } from "react";
import { SaveBar } from "@/components/project/save-bar.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";
import { Field, Textarea } from "@/components/ui/field.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, mutate } from "@/lib/client-api.ts";

const MAX = 8000;

/** 全局指令：任务开始时连同任务内容一起发给智能体 */
export default function ProjectInstructions() {
  const { project } = useProjectCtx();
  const toast = useToast();
  const saved = project.instructions ?? "";
  const [text, setText] = useState(saved);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setText(saved), [saved]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiPatch(`/api/projects/${project.id}`, { instructions: text });
      mutate("/api/projects");
      toast("ok", "全局指令已保存，之后创建的任务生效");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <form onSubmit={save} className="grid gap-4 p-4">
        <p className="max-w-2xl text-[13px] text-ink-2">写这个项目的背景、技术栈、约定和禁区。每个任务开始时，这段文字会作为“项目说明”放在任务内容之前一起发给智能体，对这个项目的所有任务都适用。</p>
        {project.canManage===false&&<p className="text-sm text-ink-2">修改全局指令需要拥有全部绑定机器的使用权限。</p>}
        <Field label="全局指令" hint={`${text.length} / ${MAX}`}>
          {(id) => <Textarea disabled={project.canManage===false} id={id} value={text} onChange={(e) => setText(e.target.value)} rows={14} maxLength={MAX} placeholder="例如：这是一个 Next.js 项目，用 pnpm；不要改 legacy/ 目录；提交信息用中文；样式沿用现有的 Tailwind 约定。" />}
        </Field>
        <SaveBar busy={busy} dirty={text !== saved} disabled={project.canManage===false} error={error} />
      </form>
    </Card>
  );
}
