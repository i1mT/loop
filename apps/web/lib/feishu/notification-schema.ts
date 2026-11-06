import { FEISHU_MIGRATIONS } from "./schema.ts";

const context = `NULLIF(current_setting('loop.feishu_notification',true),'')::jsonb`;
const detail = `CASE WHEN (${context})->>'taskId'=NEW.id THEN (${context})->>'detail' WHEN NEW.stage IN ('failed','needs_you','publish_review') THEN NEW.error WHEN TG_OP='UPDATE' AND OLD.stage='needs_you' AND NEW.stage='running' THEN (SELECT i.body FROM inbox i JOIN sessions s ON s.id=i.session_id WHERE s.task_id=NEW.id AND i.kind='message' AND i.created_at>=OLD.updated_at ORDER BY i.id DESC LIMIT 1) ELSE NULL END`;
const snapshot = `COALESCE(NULLIF(${detail},''),CASE WHEN NEW.stage IN ('failed','needs_you','publish_review') THEN NEW.error ELSE NULL END)`;
const original = FEISHU_MIGRATIONS.find(sql => sql.startsWith("CREATE OR REPLACE FUNCTION loop_feishu_stage_event()"));
if(!original?.includes("notification_chat_id)")||!original.includes("b.notification_chat_id FROM"))
  throw new Error("飞书阶段触发器结构发生变化，请同步通知迁移");

export const FEISHU_NOTIFICATION_SCHEMA = [
  `ALTER TABLE feishu_stage_events ADD COLUMN IF NOT EXISTS detail TEXT`,
  `ALTER TABLE feedback_subscriptions ADD COLUMN IF NOT EXISTS chat_type TEXT NOT NULL DEFAULT 'group'`,
  `UPDATE feedback_subscriptions s SET chat_type=source.chat_type FROM (
    SELECT DISTINCT ON (binding_id,payload::jsonb#>>'{message,message_id}') binding_id,
      payload::jsonb#>>'{message,message_id}' AS message_id,payload::jsonb#>>'{message,chat_type}' AS chat_type
    FROM feishu_jobs WHERE kind='inbox' AND payload::jsonb#>>'{message,chat_type}' IN ('group','p2p')
    ORDER BY binding_id,payload::jsonb#>>'{message,message_id}',created_at DESC
  ) source WHERE s.binding_id=source.binding_id AND s.message_id=source.message_id`,
  `UPDATE feishu_jobs j SET payload=(j.payload::jsonb || jsonb_build_object('replyInThread',s.chat_type<>'p2p'))::text
    FROM feedback_subscriptions s WHERE j.binding_id=s.binding_id AND j.kind='reply'
      AND j.payload::jsonb->>'messageId'=s.message_id AND j.payload::jsonb->>'chatId'=s.chat_id
      AND NOT(jsonb_exists(j.payload::jsonb,'replyInThread'))`,
  `ALTER TABLE feishu_jobs ADD COLUMN IF NOT EXISTS remote_message_id TEXT`,
  `CREATE TABLE IF NOT EXISTS feishu_task_threads (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    binding_id TEXT NOT NULL REFERENCES space_feishu_bindings(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL, root_message_id TEXT, creation_uuid TEXT NOT NULL,
    locked_until BIGINT NOT NULL DEFAULT 0, lock_token TEXT,
    PRIMARY KEY(task_id,binding_id,chat_id))`,
  original.replaceAll("notification_chat_id)", "notification_chat_id,detail)")
    .replaceAll("b.notification_chat_id FROM", `b.notification_chat_id,${snapshot} FROM`),
];
