export interface TechnicalPlanState {
  phase: "analyzing" | "syncing" | "awaiting_review" | "implementing";
  round: number;
  revision: number;
  markdown: string;
  documentUrl: string | null;
  syncError: string | null;
  continuationId: string | null;
}
export const TECHNICAL_PLAN_INSTRUCTION = `\n\n## 本轮要求：先形成技术方案\n本轮只能阅读代码、分析需求，不得修改文件、创建提交或执行发布。请输出完整的 Markdown 技术方案，必须包含以下二级标题：背景、目标、技术实现、改动点、验证方式、风险与回滚。“目标”包含非目标，“改动点”列出模块与文件，“技术实现”说明数据和接口。正文使用以下标记包围：\n<loop-technical-plan>\n## 背景\n……\n</loop-technical-plan>\n完成方案后结束本轮，等待系统确认文档保存和方案审核，再开始实现。`;
export function extractTechnicalPlan(report: string): string {
  const match = report.match(
    /<loop-technical-plan>\s*([\s\S]*?)\s*<\/loop-technical-plan>/,
  );
  if (!match)
    throw new Error("智能体没有输出完整技术方案，请在会话中要求重新生成方案");
  const text = match[1].trim();
  if (text.length < 100 || text.length > 60000)
    throw new Error("技术方案长度无效");
  for (const section of [
    "背景",
    "目标",
    "技术实现",
    "改动点",
    "验证方式",
    "风险与回滚",
  ])
    if (!new RegExp(`^#{1,3}\\s+${section}`, "m").test(text))
      throw new Error(`技术方案缺少“${section}”章节`);
  return text;
}
export function continuationPrompt(plan: TechnicalPlanState): string {
  return `【Loop 方案执行 ${plan.continuationId}】\n技术方案已经保存${plan.documentUrl ? `：${plan.documentUrl}` : ""}，并且已获得所需的审核。现在开始按以下方案实现，完成后报告实际改动、方案偏差和验证结果。\n\n${plan.markdown}`;
}
