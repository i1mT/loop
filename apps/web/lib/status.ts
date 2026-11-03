// 状态词典：任务阶段 → 文案、色调、分组、提示。任务列表、详情、侧边栏共用，只在这里定义。
import { canTransition, TERMINAL, type Stage } from "@loop/core";

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
  approved: { label: "已通过", tone: "live", group: "active", hint: "审核通过，等待发布" },
  publishing: { label: "发布中", tone: "live", group: "active", hint: "PR 已合并，智能体正在原会话里执行发布" },
  publish_review: { label: "待确认发布", tone: "review", group: "review", hint: "智能体没有明确说发布成败，等你确认结果" },
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
/** 已发布：有新意见可以继续迭代——同一个会话接着改（保留上下文），新开一个 PR，审核后再次发布 */
export const canIterate = (s: Stage): boolean => s === "published";
/** 能往会话里发消息：还有会话在管理的阶段，或已发布（发消息即开始新一轮）；失败、驳回、取消的任务没人会取走消息 */
export const canReply = (s: Stage): boolean => !TERMINAL.has(s) || canIterate(s);
/** 任务可以取消（由状态机决定） */
export const canCancel = (s: Stage): boolean => canTransition(s, "cancelled");
/** 发布环节与失败态：人可以手动改结果 */
export const canOverrideOutcome = (s: Stage): boolean => ["approved", "publishing", "publish_review", "failed"].includes(s);

export function stageInfo(stage: string): StageInfo {
  return STAGE_INFO[stage as Stage] ?? { label: stage, tone: "idle", group: "active", hint: "" };
}

export const GROUP_LABEL: Record<Group, string> = {
  attention: "需要你",
  review: "待审核",
  active: "进行中",
  done: "已完成",
  closed: "已结束",
};
export const GROUP_ORDER: Group[] = ["attention", "review", "active", "done", "closed"];

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
