// HTTP 与持久后台任务共用同一个 Worker；定时扫描确保请求结束或进程重启后仍能继续。
import app from "vinext/server/fetch-handler";
import { recoverFeedbackSubmissions } from "./lib/batch.ts";
import { getDb } from "./lib/db.ts";
import { publicOrigin } from "./lib/public-url.ts";
import { getEnv } from "./lib/env.ts";
import { parseLocalConfig } from "./lib/local-mode.ts";
import { processFeishuJobs } from "./lib/feishu/jobs/runner.ts";
import { processTaskPlans } from "./lib/task-plan/process.ts";

async function runIntegrations(): Promise<void> {
  const env = getEnv();
  if (!env.FEISHU_ENCRYPTION_KEY || parseLocalConfig(env.LOOP_LOCAL)) return;
  const db = await getDb();
  await recoverFeedbackSubmissions(db);
  await processTaskPlans(db);
  await processFeishuJobs(
    db,
    env.FEISHU_ENCRYPTION_KEY,
    publicOrigin(env.LOOP_PUBLIC_URL),
    5,
  );
}

function runSafely(): Promise<void> {
  return runIntegrations().catch(() => {
    // 凭证和第三方响应不能进入日志；具体失败原因保存在有空间权限限制的作业记录里。
    console.error(JSON.stringify({ event: "integration_scheduler_failed" }));
  });
}

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
      ctx.waitUntil(runSafely());
    }
    return response;
  },
  scheduled(
    _controller: ScheduledController,
    _env: unknown,
    ctx: ExecutionContext,
  ): void {
    ctx.waitUntil(runSafely());
  },
};
