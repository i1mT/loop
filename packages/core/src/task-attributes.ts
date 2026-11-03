// 任务属性：在创建任务时由网关一次定好，之后智能体只读。
// 修复线上痛点："发布审核不应该交由智能体自己去修改"。
export const ATTRIBUTE_KEYS = ["releaseReview", "planReview", "batchEligible", "previewSlot", "priority"] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

export interface TaskAttributes {
  releaseReview: boolean;
  planReview: boolean;
  batchEligible: boolean;
  previewSlot: string | null;
  priority: "low" | "normal" | "urgent";
}

export type AgentActor = { actor: "agent"; taskId: string };
export type GatewayActor = { actor: "gateway"; taskId: string };
export type Actor = AgentActor | GatewayActor;

/** 只有网关可以改属性；智能体的任何属性修改都返回错误 */
export function canWriteAttribute(actor: Actor, _key: AttributeKey): boolean {
  return actor.actor === "gateway";
}

/** 生成属性补丁：智能体提交的补丁若含属性键，整体拒绝 */
export function validateAgentPatch(actor: Actor, patch: Record<string, unknown>): { ok: true } | { ok: false; rejected: string[] } {
  const rejected = Object.keys(patch).filter((k) => (ATTRIBUTE_KEYS as readonly string[]).includes(k) && !canWriteAttribute(actor, k as AttributeKey));
  return rejected.length ? { ok: false, rejected } : { ok: true };
}
