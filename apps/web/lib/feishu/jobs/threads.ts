import type { Db } from "../../pg.ts";
import type { FeishuClient } from "../client.ts";
import type { Job } from "./store.ts";

export interface OutgoingMessage {
  messageId?: string;
  chatId: string;
  text: string;
  card?: unknown;
  taskId?: string;
  round?: number;
  replyInThread?: boolean;
}
export class ThreadBusy extends Error {}

function messageId(value: string): string {
  if (!value) throw new Error("飞书未返回消息编号");
  return value;
}

async function receipt(db: Db, job: Job, id: string) {
  await db.prepare(`UPDATE feishu_jobs SET remote_message_id=? WHERE id=? AND lock_token=?`)
    .bind(messageId(id), job.id, job.lock_token).run();
}

/** 话题租约覆盖发送与回执保存；重试复用原始内容和幂等标识。 */
export async function sendNotification(db: Db, client: FeishuClient, job: Job, payload: OutgoingMessage): Promise<void> {
  if (job.remote_message_id) return;
  const reply = async (root: string, uuid: string, inThread: boolean) => payload.card
    ? client.replyCard(root, payload.card, uuid, inThread)
    : client.reply(root, payload.text, uuid, inThread);
  const send = async (uuid: string, content = payload) => content.card
    ? client.sendCard(content.chatId, content.card, uuid)
    : client.sendText(content.chatId, content.text, uuid);
  if (payload.messageId) {
    await receipt(db, job, await reply(payload.messageId, job.id, payload.replyInThread ?? !!payload.taskId));
    return;
  }
  if (!payload.taskId) {
    await receipt(db, job, await send(job.id));
    return;
  }
  await db.prepare(`INSERT INTO feishu_task_threads(task_id,binding_id,chat_id,creation_uuid) VALUES(?,?,?,?) ON CONFLICT DO NOTHING`)
    .bind(payload.taskId, job.binding_id, payload.chatId, job.id).run();
  const token = crypto.randomUUID(), at = Date.now();
  const thread = await db.prepare(`UPDATE feishu_task_threads SET locked_until=?,lock_token=?
    WHERE task_id=? AND binding_id=? AND chat_id=? AND locked_until<? RETURNING root_message_id,creation_uuid`)
    .bind(at + 120000, token, payload.taskId, job.binding_id, payload.chatId, at)
    .first<{ root_message_id: string | null; creation_uuid: string }>();
  if (!thread) throw new ThreadBusy("通知话题正在发送");
  try {
    const task = await db.prepare(`SELECT round FROM tasks WHERE id=?`).bind(payload.taskId).first<{ round: number }>();
    if (!task || task.round !== payload.round) return;
    const saved = await db.prepare(`SELECT remote_message_id FROM feishu_jobs WHERE id=?`).bind(job.id).first<{remote_message_id:string|null}>();
    if(saved?.remote_message_id)return;
    let root = thread.root_message_id;
    if (!root) {
      const creator = await db.prepare(`SELECT payload,remote_message_id FROM feishu_jobs WHERE id=?`)
        .bind(thread.creation_uuid).first<{ payload: string; remote_message_id: string | null }>();
      const original: OutgoingMessage = creator ? JSON.parse(creator.payload) : payload;
      // 尚未发送过通知就开始迭代时，以本次通知建立话题，不发送旧轮次内容。
      const sameRound = original.round === task.round;
      const uuid = sameRound ? thread.creation_uuid : job.id;
      root = messageId((sameRound && creator?.remote_message_id) || await send(uuid, sameRound ? original : payload));
      await db.batch([
        db.prepare(`UPDATE feishu_task_threads SET root_message_id=?,creation_uuid=?
          WHERE task_id=? AND binding_id=? AND chat_id=? AND lock_token=?`)
          .bind(root, uuid, payload.taskId, job.binding_id, payload.chatId, token),
        db.prepare(`UPDATE feishu_jobs SET remote_message_id=?,state=CASE WHEN state='running' THEN state ELSE 'done' END
          WHERE id=?`).bind(root, uuid),
      ]);
      // 恢复的是另一条通知的首发结果，当前通知仍然需要独立回复，不能把它当成已经发送。
      if (uuid === job.id) return;
    }
    await receipt(db, job, await reply(root, job.id, true));
  } finally {
    await db.prepare(`UPDATE feishu_task_threads SET locked_until=0,lock_token=NULL
      WHERE task_id=? AND binding_id=? AND chat_id=? AND lock_token=?`)
      .bind(payload.taskId, job.binding_id, payload.chatId, token).run();
  }
}
