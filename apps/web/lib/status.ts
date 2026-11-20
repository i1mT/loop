// 状态词典：任务阶段 → 文案、色调、分组、提示。任务列表、详情、侧边栏共用，只在这里定义。
import { canTransition, isDeliveryStage, TERMINAL, type Stage } from "@loop/core";

export type Tone = "idle" | "live" | "review" | "ok" | "bad" | "warn";
export type Group = "attention" | "review" | "active" | "done" | "closed";

export interface StageInfo {
  label: string;
  tone: Tone;
  group: Group;
  hint: string;
}

export const STAGE_INFO: Record<Stage, StageInfo> = {
  received: { label: "已收到", tone: "idle", group: "active", hint: "已收到，等待排队" },
  batched: { label: "等待合并", tone: "idle", group: "active", hint: "改动很小，攒够条数后合成一个任务处理" },
  held: { label: "待确认", tone: "warn", group: "attention", hint: "需要管理员确认后才会开始" },
  queued: { label: "排队中", tone: "idle", group: "active", hint: "等待绑定的机器领取" },
  running: { label: "处理中", tone: "live", group: "active", hint: "智能体正在工作" },
  needs_you: { label: "需要你", tone: "warn", group: "attention", hint: "智能体在等你的决定或回复" },
  plan_reviewing: { label: "方案审核", tone: "review", group: "review", hint: "方案已产出，等你批准后才会开始实现" },
  plan_approved: { label: "方案已通过", tone: "live", group: "active", hint: "方案已通过，等待开始实现" },
  reviewing: { label: "待审核", tone: "review", group: "review", hint: "改动已提交并创建了 PR，等你审核" },
  approved: { label: "等待发布", tone: "idle", group: "active", hint: "审核已通过，等待执行机器领取" },
  publishing: { label: "发布中", tone: "live", group: "active", hint: "执行机器正在处理发布任务" },
  publish_review: { label: "待确认发布", tone: "review", group: "review", hint: "请确认线上的发布结果" },
  preview_deploy: { label: "部署预览环境", tone: "live", group: "active", hint: "自动合入 dev 并等待部署流水线" },
  preview_test: { label: "预览环境测试", tone: "live", group: "active", hint: "智能体正在验证预览环境" },
  production_review: { label: "等待合入 main", tone: "review", group: "review", hint: "请查看这批改动并确认合入" },
  production_deploy: { label: "部署生产环境", tone: "live", group: "active", hint: "合入 main 后等待部署流水线" },
  production_test: { label: "生产环境回归测试", tone: "live", group: "active", hint: "生产已部署，智能体正在回归测试" },
  published: { label: "已发布", tone: "ok", group: "done", hint: "PR 已合并，发布完成" },
  rejected: { label: "已驳回", tone: "idle", group: "closed", hint: "已被驳回，不会再处理" },
  failed: { label: "失败", tone: "bad", group: "closed", hint: "执行失败，详情见检查与活动" },
  cancelled: { label: "已取消", tone: "idle", group: "closed", hint: "已取消" },
};

/** 阶段文案（不含色调等）：错误提示等纯文本场景用 */
export const STAGE_LABEL = Object.fromEntries(Object.entries(STAGE_INFO).map(([k, v]) => [k, v.label])) as Record<Stage, string>;

// ---- 按阶段决定“能做什么”：界面与接口共用，只在这里定义 ----
/** 已结束（终态）：可以归档 */
export const isFinished = (s: Stage): boolean => TERMINAL.has(s);
export const canArchive = isFinished;
/** 还没交给智能体：这时才能改正文 */
export const canEditBody = (s: Stage): boolean => ["received", "batched", "held", "queued"].includes(s);
/** 失败、驳回、取消：可以用同样的内容重新开始（新建副本） */
export const canRestart = (s: Stage): boolean => ["rejected", "failed", "cancelled"].includes(s);
/** 取消、驳回、失败的任务（本机还有它的会话记录时）：人可以改回“待审核”，由守护进程重建工作树并重新推送、创建 PR */
export const canRestore = (s: Stage): boolean => ["rejected", "failed", "cancelled"].includes(s);
/** 待审核却还没有 PR（推送或建 PR 失败）：人可以让守护进程立刻重试 */
export const canRepublish = (s: Stage, hasPr: boolean): boolean => s === "reviewing" && !hasPr;
/** 已经有 PR（通常已合并）但发布失败：复用原 PR 直接重试发布，不要再走“重建分支 + 新建 PR” */
export const canRetryPublish = (s: Stage, hasPr: boolean, hasApproved: boolean, hasMerge: boolean): boolean => ["failed", "publish_review", "reviewing"].includes(s) && (hasMerge || (hasPr && hasApproved));
export type ReturnStage = "reviewing" | "development";

/** 已合并的 PR 无法撤回审批，继续开发时保留原会话并另开一轮。 */
export const startsNewRound = (stage: Stage, merged: boolean): boolean =>
  stage === "published" || stage === "publish_review" || (merged && (stage === "failed" || stage === "reviewing"));

export function previousTaskStage(stage: Stage, merged: boolean, hasHead: boolean): ReturnStage | null {
  if (stage === "approved" || stage === "publishing" || (stage === "failed" && (hasHead || merged))) return "reviewing";
  if ((stage === "published" || stage === "publish_review") && merged) return "reviewing";
  if (startsNewRound(stage, merged)) return "development";
  if (stage === "reviewing" || stage === "plan_reviewing") return "development";
  return null;
}

export const resumesClosedTask = (s: Stage): boolean => s === "failed" || s === "rejected" || s === "cancelled";
export const revisesReview = (s: Stage): boolean => s === "reviewing" || s === "approved" || s === "plan_reviewing";
export const canDrainWorkInbox = (s: Stage): boolean => !TERMINAL.has(s) && s !== "publishing" && s !== "publish_review" && !isDeliveryStage(s);
/** 任务可以取消（由状态机决定） */
export const canCancel = (s: Stage): boolean => canTransition(s, "cancelled");
/** 发布环节与失败态：人可以手动改结果 */
export const canOverrideOutcome = (s: Stage): boolean => ["approved", "publishing", "publish_review", "failed"].includes(s);

export function stageInfo(stage: string): StageInfo {
  return STAGE_INFO[stage as Stage] ?? { label: stage, tone: "idle", group: "active", hint: "" };
}

/** 旧版把等待超时记成失败，页面按结果待确认展示，避免把遗留会话状态当作实时运行。 */
export function isLegacyPublishTimeout(task: { stage: string; merge_sha?: string | null; error: string | null }): boolean {
  return task.stage === "failed" && !!task.merge_sha && hasLegacySessionTimeout(task.error);
}

export function hasLegacySessionTimeout(text?: string | null): boolean {
  return /等待会话\s+\S+\s+状态超时（当前\s+[^）]*）/.test(text ?? "");
}

export function taskStageInfo(task: { stage: string; merge_sha?: string | null; error: string | null }): StageInfo {
  if (isDeliveryStage(task.stage) && task.error) return { ...stageInfo(task.stage), tone: "bad", group: "attention", hint: task.error };
  if (isLegacyPublishTimeout(task)) return STAGE_INFO.publish_review;
  if (task.stage === "failed" && task.merge_sha) {
    return { ...STAGE_INFO.failed, label: "发布失败", hint: "代码已合并，本次发布未成功" };
  }
  return stageInfo(task.stage);
}

type ListedTaskStatus = Parameters<typeof taskStageInfo>[0] & { lease_active?: boolean; plan_phase?: string | null };

/** “进行中”包括排队。只有执行阶段且机器仍持有租约时，才算正在执行。 */
export function isTaskExecuting(task: ListedTaskStatus): boolean {
  return task.lease_active === true && taskStageInfo(task).tone === "live";
}

export function listedTaskStageInfo(task: ListedTaskStatus): StageInfo {
  const info = taskStageInfo(task);
  if (info.tone !== "live") return info;
  if (task.lease_active === false) {
    return { ...info, tone: "idle", label: task.stage === "running" ? "等待机器接手" : info.label, hint: "等待执行机器接手" };
  }
  if (task.stage === "running" && task.plan_phase) {
    return { ...info, label: PLAN_PHASE_LABEL[task.plan_phase] ?? info.label };
  }
  return info;
}

export interface TaskProgress {
  info: StageInfo;
  step: { index: number; closed: boolean };
  activity: { label: string; spinning: boolean; agentRunning?: boolean; waiting?: boolean } | null;
}

export function taskProgress(
  task: { stage: Stage; approved_sha?: string | null; merge_sha?: string | null; merged_at?: number | null; error: string | null },
  session: { state: string; updated_at?: number } | null,
  leaseActive: boolean,
  delivery?: { planPhase: string | null },
): TaskProgress {
  let info = taskStageInfo(task);
  let step = pipelinePosition(task.stage);
  let activity: TaskProgress["activity"] = null;
  if (task.stage === "failed" && !delivery) {
    step = pipelinePosition(task.merge_sha || task.approved_sha ? "publishing" : "running");
  }
  if (task.stage === "publishing") {
    const running = leaseActive && session?.state === "running" &&
      (session.updated_at ?? 0) >= (task.merged_at ?? Number.POSITIVE_INFINITY);
    const label = !leaseActive ? "等待机器接手发布" : running ? "智能体正在发布" : task.merge_sha ? "正在准备发布" : "正在同步并合并 PR";
    info = { ...info, label: running ? "发布中" : label, tone: leaseActive ? "live" : "idle",
      hint: running ? "可以在会话里查看发布进度" : task.merge_sha ? "代码已合并" : "合并后将开始发布" };
    activity = { label, spinning: leaseActive, agentRunning: running };
  } else if (task.stage === "running" || task.stage === "plan_approved") {
    const label = !leaseActive ? "等待执行机器" : session?.state === "running" ? "智能体正在处理" : session?.state === "idle" ? "正在准备审核" : "正在准备会话";
    activity = { label, spinning: leaseActive, agentRunning: leaseActive && session?.state === "running" };
    info = { ...info, label, tone: leaseActive ? "live" : "idle", hint: "" };
  } else if (task.stage === "needs_you") {
    activity = { label: "等待你的回复", spinning: false, waiting: true };
  }
  if (delivery) {
    const stepStage = task.stage === "failed" ? "running" : task.stage;
    step = deliveryPosition(stepStage, delivery.planPhase);
    if (task.stage === "running" && step.index === 1 && leaseActive) {
      info = { ...info, label: PLAN_PHASE_LABEL[delivery.planPhase ?? "analyzing"] ?? "技术方案" };
    }
  }
  return { info, step, activity };
}

export const GROUP_LABEL: Record<Group, string> = {
  attention: "需要你",
  review: "待审核",
  active: "进行中",
  done: "已完成",
  closed: "已结束",
};
export const GROUP_ORDER: Group[] = ["attention", "review", "active", "done", "closed"];

export const DELIVERY_PIPELINE = ["排队", "方案", "开发", "预览部署", "预览测试", "生产发布", "生产回归"] as const;

export function deliveryPosition(stage: Stage, planPhase: string | null): TaskProgress["step"] {
  switch (stage) {
    case "plan_reviewing": return { index: 1, closed: false };
    case "plan_approved":
    case "running":
    case "needs_you": return { index: planPhase === "implementing" ? 2 : 1, closed: false };
    case "preview_deploy": return { index: 3, closed: false };
    case "preview_test": return { index: 4, closed: false };
    case "production_review":
    case "production_deploy": return { index: 5, closed: false };
    case "production_test": return { index: 6, closed: false };
    case "published": return { index: 7, closed: false };
    default: return pipelinePosition(stage);
  }
}

export const PIPELINE = ["排队", "开发", "审核", "发布"] as const;

/** 阶段在四步流水线里的位置：index 为当前步（4 表示全部完成），终止态没有当前步 */
export function pipelinePosition(stage: string): { index: number; closed: boolean } {
  switch (stage) {
    case "received":
    case "batched":
    case "held":
    case "queued":
      return { index: 0, closed: false };
    case "running":
    case "needs_you":
    case "plan_reviewing":
    case "plan_approved":
      return { index: 1, closed: false };
    case "reviewing":
      return { index: 2, closed: false };
    case "approved":
    case "publishing":
    case "publish_review":
      return { index: 3, closed: false };
    case "published":
      return { index: 4, closed: false };
    default:
      return { index: -1, closed: true };
  }
}

export const SESSION_STATE_LABEL: Record<string, string> = {
  starting: "启动中",
  running: "运行中",
  idle: "空闲",
  needs_you: "等待你",
  cancelled: "已取消",
  crashed: "已崩溃",
  failed: "失败",
  ended: "已结束",
};

/** 规模（Jev 判定）的中文 */
export const SCALE_LABEL: Record<string, string> = { tiny: "微小", small: "小", medium: "中", large: "大" };

export const AGENT_LABEL: Record<string, string> = { claude: "Claude", codex: "Codex", grok: "Grok", opencode: "OpenCode", pi: "Pi", dsh: "DeepSeek Harness" };

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
/** 常见取值的中文；各智能体自己的取值（pi 的 low/high，dsh 的 off/low/high/max，opencode 的 none/default 等）不认识的原样显示 */
export const EFFORT_LABEL: Record<string, string> = { off: "关闭", none: "无", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高", default: "默认" };

/** 技术方案执行过程，独立于任务主阶段。 */
export const PLAN_PHASE_LABEL: Record<string, string> = {
  analyzing: "正在分析方案", syncing: "正在保存方案", awaiting_review: "等待方案审核",
  implementing: "正在实现", completed: "已经完成", failed: "需要处理",
};
