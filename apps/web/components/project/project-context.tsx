"use client";
import { createContext, useContext } from "react";
import type { MachineItem, ProjectItem, TaskItem } from "@/lib/types.ts";

export interface ProjectCtx {
  project: ProjectItem;
  machines: MachineItem[];
  /** 这个项目的全部任务（按更新时间倒序） */
  tasks: TaskItem[];
  tasksLoading: boolean;
}

const Ctx = createContext<ProjectCtx | null>(null);
export const ProjectProvider = Ctx.Provider;

export function useProjectCtx(): ProjectCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useProjectCtx 只能在项目页面内使用");
  return v;
}
