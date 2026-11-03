// 任务阶段状态机。没有 `blocked`：需要人介入一律是 `needs_you`，可在网关内回复后恢复。
// 事实源：docs/contracts/task-states.md
export const STAGES = [
  "received", // 已收到，未派发
  "batched", // 等待合并（小改动攒批）
  "held", // 被拦下，等管理员放行
  "queued", // 已派发，等待会话启动
  "running", // 会话执行中
  "needs_you", // 需要人工介入（结构化请求）
  "plan_reviewing", // 方案审核中（要不要做）
  "plan_approved", // 方案已通过
  "reviewing", // 已有预览，等待发布审核
  "approved", // 发布审核通过，待发布
  "publishing", // 发布执行中（智能体在项目主分支上执行发布）
  "publish_review", // 智能体发布结束但没有给出明确结论，等人确认结果
  "published", // 已发布（终态）
  "rejected", // 审核驳回（终态，可由人重开）
  "failed", // 失败（终态，可由人重试）
  "cancelled", // 已取消（终态）
] as const;
export type Stage = (typeof STAGES)[number];

export const TERMINAL: ReadonlySet<Stage> = new Set<Stage>(["published", "rejected", "failed", "cancelled"]);

// 允许的转换。终态只能通过人工动作重开（reopen），不属于自动转换。
const EDGES: Record<Stage, readonly Stage[]> = {
  received: ["batched", "held", "queued", "cancelled", "failed"],
  batched: ["queued", "cancelled"],
  held: ["queued", "cancelled"],
  queued: ["running", "failed", "cancelled"],
  running: ["needs_you", "plan_reviewing", "reviewing", "failed", "cancelled"],
  needs_you: ["running", "plan_reviewing", "cancelled", "failed"],
  plan_reviewing: ["plan_approved", "rejected", "cancelled"],
  plan_approved: ["running", "cancelled"],
  reviewing: ["approved", "rejected", "running", "cancelled"], // 驳回后可回到 running 继续改
  approved: ["publishing", "cancelled"],
  // 发布前发现提交已变（主分支前进导致 rebase）：必须重新审核，只能回到 reviewing
  publishing: ["published", "publish_review", "failed", "reviewing"],
  publish_review: ["published", "failed"],
  published: [],
  rejected: [],
  failed: [],
  cancelled: [],
};

export function canTransition(from: Stage, to: Stage): boolean {
  return EDGES[from].includes(to);
}

export function nextStages(from: Stage): readonly Stage[] {
  return EDGES[from];
}

/** 人工重开：只允许从终态回到 received（重新走分类与派发），其他终态不可直接改。 */
export function canReopen(from: Stage): boolean {
  return from === "rejected" || from === "failed" || from === "cancelled";
}
