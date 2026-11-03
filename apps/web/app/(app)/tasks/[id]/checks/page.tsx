"use client";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { StatusPill } from "@/components/ui/badge.tsx";
import { EmptyState } from "@/components/ui/states.tsx";

/** 检查：测试、预览、推送与 PR 的结果 */
export default function TaskChecks() {
  const { checks } = useTaskCtx();
  return (
    <div className="grid gap-3 pt-4">
      {checks.length === 0 ? (
        <EmptyState title="还没有检查结果">每一轮结束后，系统会运行项目 AGENTS.md 里约定的测试和预览命令。</EmptyState>
      ) : (
        checks
          .slice()
          .reverse()
          .map((c) => (
            <details key={c.key} open={!c.ok} className="overflow-hidden rounded-card border border-line">
              <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-[13px] hover:bg-canvas/60">
                <StatusPill tone={c.ok ? "ok" : "bad"}>{c.ok ? "通过" : "未通过"}</StatusPill>
                <span className="font-medium">{{ test: "测试", preview: "预览", publish: "推送与 PR" }[c.name] ?? c.name}</span>
              </summary>
              <pre className="num overflow-x-auto whitespace-pre-wrap border-t border-line bg-sunken px-3 py-2 text-xs leading-5">{c.output || "（没有输出）"}</pre>
            </details>
          ))
      )}
    </div>
  );
}
