"use client";
import { useTaskCtx } from "@/components/task/task-context.tsx";
import { EmptyState } from "@/components/ui/states.tsx";
import { clockTime } from "@/lib/format.ts";

/** 活动：会话状态、检查、通知的时间线 */
export default function TaskActivity() {
  const { activity } = useTaskCtx();
  return (
    <div className="pt-4">
      {activity.length === 0 ? (
        <EmptyState title="暂无活动" />
      ) : (
        <ol className="grid gap-2.5">
          {activity.map((a, i) => (
            <li key={i} className="flex gap-3 text-[13px]">
              <time className="num w-16 shrink-0 text-xs leading-5 text-ink-3">{clockTime(a.at)}</time>
              <span className={a.tone === "bad" ? "text-bad" : a.tone === "ok" ? "text-ok" : ""}>{a.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
