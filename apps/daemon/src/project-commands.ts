// 从项目的 AGENTS.md 解析测试、预览命令。格式（每行一条）：
//   - 测试：`<命令>`
//   - 预览：`<命令>`
// 发布不再是命令：合并后由智能体在项目主分支上读 AGENTS.md 自己发布（见 publish-agent.ts）。
// 解析不到的命令返回 undefined：调用方必须明确报告"缺少约定"，不能猜命令。
export interface ProjectCommands {
  test?: string;
  preview?: string;
}

const KEYS: Record<string, keyof ProjectCommands> = { 测试: "test", 预览: "preview" };

export function parseProjectCommands(markdown: string): ProjectCommands {
  const out: ProjectCommands = {};
  for (const line of markdown.split("\n")) {
    const m = line.match(/^\s*[-*]\s*(测试|预览)\s*[：:]\s*`([^`]+)`/);
    if (m) out[KEYS[m[1]]] = m[2].trim();
  }
  return out;
}
