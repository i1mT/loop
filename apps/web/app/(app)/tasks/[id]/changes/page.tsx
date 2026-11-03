"use client";
import { DiffView } from "@/components/task/diff-view.tsx";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { EmptyState } from "@/components/ui/states.tsx";

/** 变更：智能体修改的文件 */
export default function TaskChanges() {
  const { diffs } = useTaskCtx();
  return (
    <div className="grid gap-3 pt-4">
      {diffs.length === 0 ? (
        <EmptyState title="还没有文件变更">智能体修改文件后，改动会按文件显示在这里。</EmptyState>
      ) : (
        diffs.map((d, i) => <DiffView key={d.key} path={d.path} change={d.change} patch={d.patch} open={diffs.length <= 3 && i < 3} />)
      )}
    </div>
  );
}
