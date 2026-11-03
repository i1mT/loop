"use client";
import { PoolBar } from "@/components/project/pool-bar.tsx";
import { TaskRows } from "@/components/project/task-rows.tsx";
import { useProjectCtx } from "@/components/project/project-context.tsx";

export default function ProjectTasks() {
  const { project, tasks, tasksLoading } = useProjectCtx();
  return (
    <>
      <PoolBar projectId={project.id} />
      <TaskRows tasks={tasks} loading={tasksLoading} emptyHint="点右上角“新建任务”，智能体会在独立分支上完成并提交 PR。" />
    </>
  );
}
