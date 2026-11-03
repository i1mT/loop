"use client";
import { createContext, useContext } from "react";
import type { Item } from "@/lib/session-fold.ts";
import type { SessionData } from "@/lib/use-session.ts";

export interface ActivityRow {
  at: number;
  text: string;
  tone?: "bad" | "ok";
}

export interface TaskCtx {
  /** 任务详情接口的完整数据（任务、项目、会话、事件、待处理请求等） */
  data: SessionData;
  diffs: Extract<Item, { type: "diff" }>[];
  checks: Extract<Item, { type: "check" }>[];
  activity: ActivityRow[];
  reload: () => void;
}

const Ctx = createContext<TaskCtx | null>(null);
export const TaskProvider = Ctx.Provider;

export function useTaskCtx(): TaskCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useTaskCtx 只能在任务页面内使用");
  return v;
}
