import type { Db } from "../../pg.ts";
import { getBindingById, getBindingSecrets } from "../bindings.ts";
import { FeishuClient } from "../client.ts";
import { claimJob } from "./store.ts";
import { scanStageEvents } from "./notifications.ts";
import { processMessage, type MessageEvent } from "./messages.ts";
export async function processFeishuJobs(
  db: Db,
  key: string,
  origin: string,
  limit = 20,
  fetchImpl?: typeof fetch,
): Promise<{ processed: number; failed: number; events: number }> {
  const events = await scanStageEvents(db, origin);
  let processed = 0,
    failed = 0;
  for (let i = 0; i < limit; i++) {
    const job = await claimJob(db);
    if (!job) break;
    try {
      const binding = await getBindingById(db, job.binding_id);
      if (!binding?.enabled) throw new Error("机器人已停用");
      const client = new FeishuClient(
        await getBindingSecrets(db, binding.id, key),
        fetchImpl,
      );
      if (job.kind === "inbox")
        await processMessage(
          db,
          binding,
          JSON.parse(job.payload) as MessageEvent,
          job,
          client,
          origin,
        );
      else {
        const payload = JSON.parse(job.payload) as {
          messageId?: string;
          chatId: string;
          text: string;
          taskId?: string;
          round?: number;
        };
        if (payload.taskId) {
          const task = await db
            .prepare("SELECT round FROM tasks WHERE id=?")
            .bind(payload.taskId)
            .first<{ round: number }>();
          if (!task || task.round !== payload.round) {
            await db
              .prepare(
                "UPDATE feishu_jobs SET state='done',finished_at=?,locked_until=0,error='任务轮次已经更新，已跳过过期通知' WHERE id=? AND lock_token=?",
              )
              .bind(Date.now(), job.id, job.lock_token)
              .run();
            processed++;
            continue;
          }
        }
        if (job.kind === "reply" && payload.messageId)
          await client.reply(payload.messageId, payload.text, job.id);
        else await client.sendText(payload.chatId, payload.text, job.id);
      }
      await db
        .prepare(
          "UPDATE feishu_jobs SET state='done',finished_at=?,locked_until=0,error=NULL WHERE id=? AND lock_token=?",
        )
        .bind(Date.now(), job.id, job.lock_token)
        .run();
      processed++;
    } catch (error) {
      // 不保存外部 API 的原始响应，避免日志或错误详情含有凭证和消息正文。
      const detail = error instanceof Error ? error.message : "飞书操作失败";
      const safe = /飞书|目录|图片|文档|机器人|项目|反馈|账号|技术方案/.test(
        detail,
      )
        ? detail.slice(0, 240)
        : "操作暂时未完成，请检查连接后重试";
      await db
        .prepare(
          "UPDATE feishu_jobs SET state=?,next_at=?,locked_until=0,error=? WHERE id=? AND lock_token=?",
        )
        .bind(
          job.attempts >= 8 ? "failed" : "pending",
          Date.now() + Math.min(3600000, 1000 * 2 ** job.attempts),
          safe,
          job.id,
          job.lock_token,
        )
        .run();
      failed++;
    }
  }
  return { processed, failed, events };
}
