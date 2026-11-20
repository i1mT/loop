"use client";
import { TaskActivity } from "@/components/task-list/task-activity.tsx";
import { TaskListRow } from "@/components/task-list/task-list-row.tsx";
import { Card } from "@/components/ui/page-header.tsx";
import { EmptyState, RowsSkeleton } from "@/components/ui/states.tsx";
import type { TaskItem } from "@/lib/types.ts";

/** 项目页里的任务行（概览与“任务”标签共用） */
export function TaskRows({ tasks, loading, emptyHint, showActivity }: { tasks: TaskItem[]; loading: boolean; emptyHint: string; showActivity?: boolean }) {
  return (
    <Card className="overflow-hidden">
      {loading ? (
        <RowsSkeleton rows={3} />
      ) : tasks.length === 0 ? (
        <EmptyState title="这个项目还没有任务">{emptyHint}</EmptyState>
      ) : (
        <>
          {showActivity && <TaskActivity tasks={tasks} />}
          <ul className="divide-y divide-line">
            {tasks.map((task) => (
              <li key={task.id} className="flex hover:bg-canvas/60">
                <TaskListRow task={task} className="ml-2" />
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}
