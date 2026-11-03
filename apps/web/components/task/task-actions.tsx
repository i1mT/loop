"use client";
import * as Menu from "@radix-ui/react-dropdown-menu";
import { Archive, ArchiveRestore, MoreHorizontal, Pencil, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Dialog } from "@/components/ui/dialog.tsx";
import { Field, Input, Textarea } from "@/components/ui/field.tsx";
import { useToast } from "@/components/ui/toast.tsx";
import { ApiError, apiPatch, apiPost, mutate } from "@/lib/client-api.ts";
import { canArchive, canEditBody as editableBody, canRestart } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";


/** 任务的编辑、归档/恢复、重新开始。只出现当前阶段允许的操作。 */
export function TaskActions({ task, reload }: { task: TaskItem; reload: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.body);
  const [busy, setBusy] = useState<null | "save" | "archive" | "restart">(null);
  const archived = !!task.archived_at;
  const canEditBody = editableBody(task.stage);

  async function run<T>(kind: "save" | "archive" | "restart", fn: () => Promise<T>, ok: (r: T) => void) {
    setBusy(kind);
    try {
      ok(await fn());
    } catch (e) {
      toast("error", e instanceof ApiError ? e.message : "操作失败");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Menu.Root>
        <Menu.Trigger asChild>
          <Button aria-label="更多操作" title="编辑、归档等" className="px-2">
            <MoreHorizontal className="size-4" aria-hidden />
          </Button>
        </Menu.Trigger>
        <Menu.Portal>
          <Menu.Content align="end" sideOffset={6} className="z-50 min-w-40 rounded-card border border-line bg-card p-1 text-[13px] shadow-lg">
            {!archived && (
              <Item
                icon={<Pencil className="size-4" aria-hidden />}
                onSelect={() => {
                  setTitle(task.title);
                  setBody(task.body);
                  setEditing(true);
                }}
              >
                编辑
              </Item>
            )}
            {canRestart(task.stage) && !archived && (
              <Item
                icon={<RotateCcw className="size-4" aria-hidden />}
                onSelect={() =>
                  void run(
                    "restart",
                    () => apiPost<{ task: { id: string } }>(`/api/tasks/${task.id}/restart`),
                    (r) => {
                      mutate("/api/tasks");
                      toast("ok", "已用同样的内容新建任务");
                      router.push(`/tasks/${r.task.id}`);
                    },
                  )
                }
              >
                重新开始（新建副本）
              </Item>
            )}
            {(archived || canArchive(task.stage)) && (
              <Item
                icon={archived ? <ArchiveRestore className="size-4" aria-hidden /> : <Archive className="size-4" aria-hidden />}
                onSelect={() =>
                  void run(
                    "archive",
                    () => apiPost(`/api/tasks/${task.id}/archive`, { archived: !archived }),
                    () => {
                      mutate("/api/tasks");
                      reload();
                      toast("ok", archived ? "已恢复" : "已归档");
                    },
                  )
                }
              >
                {archived ? "恢复" : "归档"}
              </Item>
            )}
          </Menu.Content>
        </Menu.Portal>
      </Menu.Root>

      <Dialog open={editing} onOpenChange={setEditing} title="编辑任务" description={canEditBody ? "任务还没开始，标题和正文都可以改。" : "任务已经开始，只能改标题；想调整要求请在会话里回复。"}>
        <div className="grid gap-4">
          <Field label="标题">{(id) => <Input id={id} value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} />}</Field>
          <Field label="正文">{(id) => <Textarea id={id} value={body} rows={10} disabled={!canEditBody} onChange={(e) => setBody(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setEditing(false)}>取消</Button>
            <Button
              variant="primary"
              loading={busy === "save"}
              disabled={!title.trim()}
              onClick={() =>
                run(
                  "save",
                  () => apiPatch(`/api/tasks/${task.id}`, { title, ...(canEditBody ? { body } : {}) }),
                  () => {
                    mutate("/api/tasks");
                    reload();
                    setEditing(false);
                    toast("ok", "已保存");
                  },
                )
              }
            >
              保存
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

function Item({ icon, children, onSelect }: { icon: ReactNode; children: ReactNode; onSelect: () => void }) {
  return (
    <Menu.Item onSelect={onSelect} className="flex cursor-pointer items-center gap-2 rounded-control px-2.5 py-2 text-ink outline-none data-[highlighted]:bg-sunken">
      {icon}
      {children}
    </Menu.Item>
  );
}
