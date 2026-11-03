// 会话状态 → 任务阶段。纯函数，不依赖 Workers 运行时，便于单元测试。
// 规则：只允许 @loop/core 状态机里合法的转换；不合法的一律忽略（并由调用方记录）。
import { canTransition, type Stage } from "@loop/core";

export type SessionState = "starting" | "running" | "idle" | "needs_you" | "cancelled" | "crashed" | "failed" | "ended";

/** 会话状态对应的目标阶段；返回 null 表示该状态不影响任务阶段 */
export function targetStage(state: SessionState): Stage | null {
  switch (state) {
    case "starting":
    case "running":
      return "running";
    case "needs_you":
    case "crashed":
      return "needs_you"; // 崩溃也交给人决定恢复还是放弃
    case "idle":
      return "reviewing"; // 一轮结束，等待审核
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "ended":
      return null;
  }
}

/** 给定当前阶段与会话状态，返回新阶段（不变则返回 current）及是否被拒绝 */
export function nextTaskStage(current: Stage, state: SessionState): { stage: Stage; rejected: boolean } {
  const target = targetStage(state);
  if (!target || target === current) return { stage: current, rejected: false };
  if (!canTransition(current, target)) return { stage: current, rejected: true };
  return { stage: target, rejected: false };
}
