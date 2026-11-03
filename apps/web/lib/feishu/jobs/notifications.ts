import type { Db } from "../../pg.ts";
import { enqueue, enqueueReply } from "./store.ts";
const LABELS: Record<string, string> = {
  received: "已经收到任务",
  queued: "任务正在等待执行",
  running: "任务已经开始执行",
  needs_you: "任务需要你处理",
  plan_reviewing: "技术方案已经准备好，等待审核",
  plan_approved: "技术方案已经通过审核",
  reviewing: "改动已经完成，等待审核",
  approved: "改动已经通过审核",
  publishing: "任务正在发布",
  publish_review: "请确认发布结果",
  published: "任务已经发布成功",
  failed: "任务执行失败，请查看详情",
  rejected: "任务已经驳回",
  cancelled: "任务已经取消",
};
export async function enqueueTaskNotification(
  db: Db,
  taskId: string,
  transitionKey: string,
  body: string,
  origin: string,
  snapshot?: { bindingId: string; notificationChatId: string | null },
): Promise<void> {
  const task = await db
    .prepare(
      "SELECT t.title,t.round,p.space_id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=?",
    )
    .bind(taskId)
    .first<{ title: string; round: number; space_id: string }>();
  if (!task) return;
  const recipients = (
    await db
      .prepare(
        `SELECT DISTINCT ON(s.binding_id,s.chat_id) s.binding_id,s.chat_id,s.message_id FROM feedback_subscriptions s JOIN feedbacks f ON f.id=s.feedback_id JOIN space_feishu_bindings b ON b.id=s.binding_id WHERE f.task_id=? AND b.space_id=? AND b.enabled=1${snapshot ? " AND b.id=?" : ""} ORDER BY s.binding_id,s.chat_id,s.message_id`,
      )
      .bind(taskId, task.space_id, ...(snapshot ? [snapshot.bindingId] : []))
      .all<{ binding_id: string; chat_id: string; message_id: string }>()
  ).results;
  const text = `${body}\n任务：${task.title}\n${origin}/tasks/${taskId}`;
  for (const r of recipients)
    await enqueueReply(
      db,
      r.binding_id,
      r.message_id,
      r.chat_id,
      text,
      `task:${taskId}:${transitionKey}:${r.binding_id}:${r.chat_id}`,
      { taskId, round: task.round },
    );
  if (!recipients.length) {
    const b = snapshot
      ? snapshot.notificationChatId
        ? {
            id: snapshot.bindingId,
            notification_chat_id: snapshot.notificationChatId,
          }
        : null
      : await db
          .prepare(
            "SELECT id,notification_chat_id FROM space_feishu_bindings WHERE space_id=? AND enabled=1 AND notification_chat_id IS NOT NULL",
          )
          .bind(task.space_id)
          .first<{ id: string; notification_chat_id: string }>();
    if (b)
      await enqueue(
        db,
        b.id,
        "send",
        `task:${taskId}:${transitionKey}:${b.id}:${b.notification_chat_id}`,
        { chatId: b.notification_chat_id, text, taskId, round: task.round },
      );
  }
}
export async function scanStageEvents(db: Db, origin: string): Promise<number> {
  const events = (
    await db
      .prepare(
        "SELECT id,task_id,round,stage,binding_id,notification_chat_id FROM feishu_stage_events WHERE queued=0 ORDER BY id LIMIT 100",
      )
      .all<{
        id: number;
        task_id: string;
        round: number;
        stage: string;
        binding_id: string | null;
        notification_chat_id: string | null;
      }>()
  ).results;
  for (const event of events) {
    const task = await db
      .prepare("SELECT round FROM tasks WHERE id=?")
      .bind(event.task_id)
      .first<{ round: number }>();
    if (task?.round === event.round && event.binding_id && LABELS[event.stage])
      await enqueueTaskNotification(
        db,
        event.task_id,
        `event:${event.id}`,
        `第 ${event.round} 轮 · ${LABELS[event.stage]}`,
        origin,
        {
          bindingId: event.binding_id,
          notificationChatId: event.notification_chat_id,
        },
      );
    await db
      .prepare("UPDATE feishu_stage_events SET queued=1 WHERE id=?")
      .bind(event.id)
      .run();
  }
  return events.length;
}
