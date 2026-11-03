export type PlanPhase =
  "analyzing" | "syncing" | "awaiting_review" | "implementing";
export interface TechnicalPlan {
  taskId: string;
  round: number;
  revision: number;
  phase: PlanPhase;
  markdown: string;
  contentHash: string;
  baselineHead: string | null;
  documentUrl: string | null;
  syncError: string | null;
  updatedAt: number;
  continuationId: string | null;
}
export const PLAN_SECTIONS = [
  "背景",
  "目标",
  "技术实现",
  "改动点",
  "验证方式",
  "风险与回滚",
] as const;
export function validatePlan(markdown: string): string | null {
  if (markdown.length < 100 || markdown.length > 60000)
    return "技术方案需要包含 100 至 60000 个字符";
  for (const section of PLAN_SECTIONS)
    if (!new RegExp(`^#{1,3}\\s+${section}`, "m").test(markdown))
      return `技术方案缺少“${section}”章节`;
  return null;
}
export function blocksImplementation(phase: PlanPhase | undefined): boolean {
  return phase !== undefined && phase !== "implementing";
}
