import type { Db } from "../../pg.ts";
export interface Job {
  id: string;
  binding_id: string;
  kind: string;
  payload: string;
  attempts: number;
  lock_token: string;
}
export async function enqueue(
  db: Db,
  bindingId: string,
  kind: string,
  dedupeKey: string,
  payload: unknown,
): Promise<void> {
  const time = Date.now();
  await db
    .prepare(
      `INSERT INTO feishu_jobs(id,binding_id,kind,dedupe_key,payload,next_at,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(dedupe_key) DO NOTHING`,
    )
    .bind(
      crypto.randomUUID(),
      bindingId,
      kind,
      dedupeKey,
      JSON.stringify(payload),
      time,
      time,
    )
    .run();
}
export async function enqueueReply(
  db: Db,
  bindingId: string,
  messageId: string,
  chatId: string,
  text: string,
  key: string,
  context?: { taskId: string; round: number },
): Promise<void> {
  return enqueue(db, bindingId, "reply", key, {
    messageId,
    chatId,
    text,
    ...context,
  });
}
export async function claimJob(db: Db): Promise<Job | null> {
  const time = Date.now();
  return db
    .prepare(
      `UPDATE feishu_jobs SET state='running',locked_until=?,lock_token=?,attempts=attempts+1 WHERE id=(SELECT j.id FROM feishu_jobs j JOIN space_feishu_bindings b ON b.id=j.binding_id WHERE b.enabled=1 AND ((j.state='pending' AND j.next_at<=?) OR (j.state='running' AND j.locked_until<?)) ORDER BY j.created_at LIMIT 1 FOR UPDATE OF j SKIP LOCKED) RETURNING feishu_jobs.*`,
    )
    .bind(time + 120000, crypto.randomUUID(), time, time)
    .first<Job>();
}
