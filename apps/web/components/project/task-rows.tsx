"use client";
import Link from "next/link";
import { Chip, StatusPill } from "@/components/ui/badge.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, RowsSkeleton } from "@/components/ui/states.tsx";
import { timeAgo } from "@/lib/format.ts";
import { stageInfo } from "@/lib/status.ts";
import type { TaskItem } from "@/lib/types.ts";

/** 项目页里的任务行（概览与“任务”标签共用） */
export function TaskRows({ tasks, loading, emptyHint }: { tasks: TaskItem[]; loading: boolean; emptyHint: string }) {
  return (
    <Card className="overflow-hidden">
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : tasks.length === 0 ? (
        <EmptyState title="这个项目还没有任务">{emptyHint}</EmptyState>
      ) : (
        <ul className="divide-y divide-line">
          {tasks.map((t) => (
            <li key={t.id}>
              <Link href={`/tasks/${t.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-canvas/60">
                <div className="w-[88px] shrink-0">
                  <StatusPill tone={stageInfo(t.stage).tone} pulse>
                    {stageInfo(t.stage).label}
                  </StatusPill>
                </div>
                <span className="min-w-0 flex-1 basis-56 truncate font-medium">{t.title}</span>
                {(t.feedback_count ?? 1) > 1 && <Chip>{t.feedback_count} 条反馈</Chip>}
                <time className="num text-xs text-ink-3">{timeAgo(t.updated_at)}</time>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
