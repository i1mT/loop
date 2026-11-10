// HTTP 与持久后台任务共用同一个 Worker；定时扫描确保请求结束或进程重启后仍能继续。
import app from "vinext/server/fetch-handler";
import { runIntegrationsSafely } from "./lib/runtime/integrations.ts";

export default {
  ...app,
  async fetch(
    request: Request,
    env: unknown,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const response = await app.fetch(request, env, ctx);
    const pathname = new URL(request.url).pathname;
    if (
      request.method !== "GET" &&
      pathname.startsWith("/api/") &&
      response.ok
    ) {
      ctx.waitUntil(runIntegrationsSafely());
    }
    return response;
  },
  scheduled(
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runIntegrationsSafely());
  },
};
