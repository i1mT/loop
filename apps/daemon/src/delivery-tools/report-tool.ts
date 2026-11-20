// ACP 启动的 MCP 服务。未注入 MCP 的适配器可以用同一个入口提交结构化结果。
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { REPORT_TOOL, submitReport, VERDICTS } from "./result.ts";

const [dir, mode, verdict, ...summary] = process.argv.slice(2);
if (!dir) throw new Error("缺少本次测试的结果目录");
if (mode === "submit") {
  submitReport(dir, { verdict, summary: summary.join(" ") });
  console.log("已记录本次测试结论。");
} else {
  const server = new Server({ name: "loop", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, () => ({
    tools: [{
      name: REPORT_TOOL,
      description: "提交本次 Loop 环境测试的最终结论。待测试完成后调用。",
      inputSchema: {
        type: "object",
        properties: {
          verdict: { type: "string", enum: [...VERDICTS], description: "通过、代码问题导致的失败、缺少外部条件而受阻" },
          summary: { type: "string", minLength: 1, maxLength: 8000, description: "测试内容、结果及未验证的项目。失败时包含复现步骤，受阻时说明所需条件。" },
        },
        required: ["verdict", "summary"],
        additionalProperties: false,
      },
    }],
  }));
  server.setRequestHandler(CallToolRequestSchema, ({ params }) => {
    try {
      if (params.name !== REPORT_TOOL) throw new Error("未知工具");
      submitReport(dir, params.arguments);
      return { content: [{ type: "text", text: "已记录本次测试结论。" }] };
    } catch (error) {
      const message = (error as NodeJS.ErrnoException).code === "ENOENT" ? "本次测试提交入口已关闭" : (error as Error).message;
      return { isError: true, content: [{ type: "text", text: message }] };
    }
  });
  await server.connect(new StdioServerTransport());
}
