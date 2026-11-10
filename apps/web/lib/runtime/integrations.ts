// 后台集成任务：恢复反馈提交、推进技术方案、处理飞书作业。
// Workers 由 fetch/scheduled 触发的 waitUntil 调用；Node 由进程内定时器调用。
import { recoverFeedbackSubmissions } from "../batch.ts";
import { getDb } from "../db.ts";
import { getEnv } from "../env.ts";
import { parseLocalConfig } from "../local-mode.ts";
import { processFeishuJobs } from "../feishu/jobs/runner.ts";
import { publicOrigin } from "../public-url.ts";
import { processTaskPlans } from "../task-plan/process.ts";

export async function runIntegrations(): Promise<void> {
  const env = getEnv();
  // 本机转发模式不存数据，后台任务只属于持有数据库的网关。
  if (!env.FEISHU_ENCRYPTION_KEY || parseLocalConfig(env.LOOP_LOCAL)) return;
  const db = await getDb();
  await recoverFeedbackSubmissions(db);
  await processTaskPlans(db);
  await processFeishuJobs(db, env.FEISHU_ENCRYPTION_KEY, publicOrigin(env.LOOP_PUBLIC_URL), 5);
}

/** 出错时不打印具体原因：第三方响应与凭证不能进入日志。 */
export function runIntegrationsSafely(): Promise<void> {
  return runIntegrations().catch(() => {
    console.error(JSON.stringify({ event: "integration_scheduler_failed" }));
  });
}
