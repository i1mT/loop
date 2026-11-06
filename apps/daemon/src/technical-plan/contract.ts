export interface TechnicalPlanState {
  title: string;
  phase: "analyzing" | "syncing" | "awaiting_review" | "implementing";
  round: number;
  revision: number;
  markdown: string;
  documentUrl: string | null;
  syncError: string | null;
  continuationId: string | null;
}
export interface TechnicalPlanDraft {
  /** AI 自己起的方案标题，用于飞书文档标题与通知，不再复用任务标题。 */
  title: string;
  /** 去掉标题行后的方案正文，原样写入文档。 */
  markdown: string;
}
export const TECHNICAL_PLAN_INSTRUCTION = `\n\n## 本轮要求：先形成技术方案\n本轮只能阅读代码、分析需求，不得修改文件、创建提交或执行发布。请输出完整的 Markdown 技术方案。\n\n第一行必须是一级标题，由你根据这次改动起一个准确、简洁的方案标题（不要直接复制任务标题，不要写任务编号）：\n# 登录态过期后自动刷新\n\n随后必须包含以下二级标题：背景、目标、技术实现、改动点、验证方式、风险与回滚。“目标”包含非目标，“改动点”列出模块与文件，“技术实现”说明数据和接口。正文使用以下标记包围：\n<loop-technical-plan>\n# 方案标题\n## 背景\n……\n</loop-technical-plan>\n完成方案后结束本轮，等待系统确认文档保存和方案审核，再开始实现。`;
const PLAN_SECTIONS = [
  "背景",
  "目标",
  "技术实现",
  "改动点",
  "验证方式",
  "风险与回滚",
];
export function extractTechnicalPlan(report: string): TechnicalPlanDraft {
  const match = report.match(
    /<loop-technical-plan>\s*([\s\S]*?)\s*<\/loop-technical-plan>/,
  );
  if (!match)
    throw new Error("智能体没有输出完整技术方案，请在会话中要求重新生成方案");
  const text = match[1].trim();
  const lines = text.split("\n");
  const first = lines.findIndex((line) => line.trim().length > 0);
  const firstLine = (lines[first] ?? "").trim();
  let title = "";
  let titleIndex = -1;
  // 大多数情况标题在标记内。也接受智能体把标题写在标记前，或标记内用二级标题充当标题。
  const h1 = /^#\s+(.+?)\s*$/.exec(firstLine);
  if (h1) {
    title = h1[1].trim();
    titleIndex = first;
  } else {
    const h2 = /^##\s+(.+?)\s*$/.exec(firstLine);
    if (h2 && !PLAN_SECTIONS.includes(h2[1].trim())) {
      title = h2[1].trim();
      titleIndex = first;
    }
  }
  if (!title) {
    // 标题可能写在 <loop-technical-plan> 之前（例如先写标题再贴方案）。
    const before = report.slice(0, match.index ?? 0).trim();
    const headings = [...before.matchAll(/^#\s+(.+?)\s*$/gm)];
    const last = headings.at(-1);
    if (last) title = last[1].trim();
  }
  if (!title) title = "技术方案";
  title = title.slice(0, 120).trim();
  if (title.length < 2) title = "技术方案";
  const markdown = lines
    .slice(titleIndex >= 0 ? titleIndex + 1 : 0)
    .join("\n")
    .trim();
  if (markdown.length < 100 || markdown.length > 60000)
    throw new Error("技术方案长度无效");
  for (const section of PLAN_SECTIONS)
    if (!new RegExp(`^#{1,3}\\s+${section}`, "m").test(markdown))
      throw new Error(`技术方案缺少“${section}”章节`);
  return { title, markdown };
}
export function continuationPrompt(plan: TechnicalPlanState): string {
  return `【Loop 方案执行 ${plan.continuationId}】\n技术方案已经保存${plan.documentUrl ? `：${plan.documentUrl}` : ""}，并且已获得所需的审核。现在开始按以下方案实现，完成后报告实际改动、方案偏差和验证结果。\n\n${plan.markdown}`;
}
