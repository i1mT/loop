// 统一会话事件：守护进程把各智能体的 ACP 更新归一化成这一种格式，网关与界面只依赖它。
// 事实源：docs/contracts/session-events.md
import { z } from "zod";

export const SessionEventKind = z.enum([
  "status", // 会话状态变化：starting | running | idle | needs_you | cancelled | crashed | failed | ended
  "message", // 智能体或用户的文本
  "thought", // 思考过程（可折叠）
  "tool", // 工具调用的一次更新（同一 toolCallId 多次出现，按 status 收敛）
  "diff", // 文件变更（由守护进程用 git 计算，不依赖智能体）
  "plan", // 计划条目
  "usage", // 用量与费用（费用可能缺失）
  "permission_request", // 需要用户批准的操作
  "permission_resolved", // 批准或拒绝的结果
  "needs_you", // 结构化的人工介入请求
  "stop", // 一轮 prompt 结束，附 stopReason
  "error", // 适配器或智能体错误
  "check", // 检查结果（测试、预览、发布）：只展示，不驱动任务阶段
]);
export type SessionEventKind = z.infer<typeof SessionEventKind>;

const Base = z.object({
  /** 会话内单调递增的序号，用于增量拉取与去重 */
  seq: z.number().int().nonnegative(),
  sessionId: z.string().min(1),
  at: z.number().int(), // 毫秒时间戳
});

export const SessionEvent = z.discriminatedUnion("kind", [
  Base.extend({ kind: z.literal("status"), payload: z.object({ state: z.enum(["starting", "running", "idle", "needs_you", "cancelled", "crashed", "failed", "ended"]), detail: z.string().optional() }) }),
  Base.extend({ kind: z.literal("message"), payload: z.object({ role: z.enum(["agent", "user"]), text: z.string() }) }),
  Base.extend({ kind: z.literal("thought"), payload: z.object({ text: z.string() }) }),
  Base.extend({
    kind: z.literal("tool"),
    payload: z.object({
      toolCallId: z.string(),
      // 可选：tool_call_update 通常不带这两项，消费方按 toolCallId 合并
      title: z.string().optional(),
      toolKind: z.enum(["read", "edit", "delete", "move", "search", "execute", "think", "fetch", "switch_mode", "other"]).optional(),
      status: z.enum(["pending", "in_progress", "completed", "failed"]),
      input: z.unknown().optional(),
      output: z.unknown().optional(),
    }),
  }),
  Base.extend({
    kind: z.literal("diff"),
    payload: z.object({ path: z.string(), change: z.enum(["added", "modified", "deleted"]), patch: z.string() }),
  }),
  Base.extend({ kind: z.literal("plan"), payload: z.object({ entries: z.array(z.object({ content: z.string(), status: z.enum(["pending", "in_progress", "completed"]) })) }) }),
  Base.extend({
    kind: z.literal("usage"),
    payload: z.object({ used: z.number().nonnegative(), size: z.number().nonnegative().optional(), costUsd: z.number().nonnegative().optional() }),
  }),
  Base.extend({
    kind: z.literal("permission_request"),
    payload: z.object({
      requestId: z.string(),
      title: z.string(),
      toolKind: z.string().optional(),
      options: z.array(z.object({ optionId: z.string(), name: z.string(), kind: z.enum(["allow_once", "allow_always", "reject_once", "reject_always"]) })).min(1),
    }),
  }),
  Base.extend({ kind: z.literal("permission_resolved"), payload: z.object({ requestId: z.string(), optionId: z.string(), decidedBy: z.enum(["policy", "human"]) }) }),
  Base.extend({ kind: z.literal("needs_you"), payload: NeedsYouRequestShape() }),
  Base.extend({ kind: z.literal("stop"), payload: z.object({ stopReason: z.enum(["end_turn", "max_tokens", "max_turn_requests", "refusal", "cancelled", "unknown"]) }) }),
  Base.extend({ kind: z.literal("error"), payload: z.object({ message: z.string(), fatal: z.boolean() }) }),
  // 检查结果与阶段无关：不能用 status 事件表达，否则会被当作阶段转换（曾导致发布中被拉回待审核）
  Base.extend({ kind: z.literal("check"), payload: z.object({ name: z.enum(["test", "preview", "publish"]), ok: z.boolean(), output: z.string() }) }),
]);
export type SessionEvent = z.infer<typeof SessionEvent>;

// 结构化人工介入：这是替代旧 `blocked` 状态的唯一方式
export function NeedsYouRequestShape() {
  return z.object({
    /** 谁触发：确定性规则（rule:*）或智能体自己提出（agent） */
    reason: z.string().min(1),
    question: z.string().min(1),
    suggestion: z.string().optional(),
    options: z
      .array(z.object({ id: z.string().min(1), label: z.string().min(1), consequence: z.string().optional() }))
      .min(1)
      .max(6),
  });
}
export const NeedsYouRequest = NeedsYouRequestShape();
export type NeedsYouRequest = z.infer<typeof NeedsYouRequest>;

/** 解析一条事件；非法事件返回错误而不是抛出，便于守护进程记录后丢弃 */
export function parseSessionEvent(raw: unknown): { ok: true; event: SessionEvent } | { ok: false; error: string } {
  const r = SessionEvent.safeParse(raw);
  return r.success ? { ok: true, event: r.data } : { ok: false, error: r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
}
