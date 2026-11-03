import type { Db } from "../pg.ts";
import { syncTaskDocument } from "../feishu/documents.ts";
import { getTechnicalPlan } from "./service.ts";

// 数据库保存重试进度；定时调度或队列重复唤醒都只处理到期的记录。
export async function processTaskPlans(db: Db): Promise<void> {
  const now = Date.now();
  const rounds = (
    await db
      .prepare(
        `UPDATE task_plan_rounds r SET locked_until=?
    WHERE (r.task_id,r.round) IN (SELECT x.task_id,x.round FROM task_plan_rounds x JOIN tasks t ON t.id=x.task_id
      WHERE x.phase='syncing' AND x.retry_at<=? AND x.locked_until<? AND t.round=x.round
      AND t.stage IN ('running','needs_you','plan_reviewing') ORDER BY x.updated_at LIMIT 5 FOR UPDATE OF x SKIP LOCKED)
    RETURNING r.task_id,r.round,r.revision`,
      )
      .bind(now + 120000, now, now)
      .all<{ task_id: string; round: number; revision: number }>()
  ).results;
  for (const row of rounds) {
    try {
      const plan = await getTechnicalPlan(db, row.task_id, row.round);
      const task = await db
        .prepare(
          `SELECT title,plan_review,stage FROM tasks WHERE id=? AND round=?`,
        )
        .bind(row.task_id, row.round)
        .first<{ title: string; plan_review: number; stage: string }>();
      if (
        !plan ||
        !task ||
        !["running", "needs_you", "plan_reviewing"].includes(task.stage)
      )
        continue;
      const { url } = await syncTaskDocument({
        taskId: row.task_id,
        round: row.round,
        title: task.title,
        markdown: plan.markdown,
        kind: "plan",
        revision: row.revision,
      });
      const at = Date.now();
      await db.batch([
        db
          .prepare(
            `UPDATE task_plan_rounds SET phase=?,document_url=?,sync_error=NULL,locked_until=0,
          continuation_id=?,updated_at=? WHERE task_id=? AND round=? AND revision=? AND phase='syncing'
          AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.round=task_plan_rounds.round AND t.stage IN ('running','needs_you','plan_reviewing'))`,
          )
          .bind(
            task.plan_review ? "awaiting_review" : "implementing",
            url,
            task.plan_review
              ? null
              : `${row.task_id}:${row.round}:${row.revision}`,
            at,
            row.task_id,
            row.round,
            row.revision,
          ),
        db
          .prepare(
            `UPDATE tasks SET stage='plan_reviewing',updated_at=? WHERE id=? AND round=? AND plan_review=1
          AND stage IN ('running','needs_you','plan_reviewing') AND EXISTS(SELECT 1 FROM task_plan_rounds r WHERE r.task_id=tasks.id AND r.round=tasks.round AND r.phase='awaiting_review')`,
          )
          .bind(at, row.task_id, row.round),
      ]);
    } catch (e) {
      await db
        .prepare(
          `UPDATE task_plan_rounds SET locked_until=0,retry_at=?,sync_error=?,updated_at=? WHERE task_id=? AND round=? AND phase='syncing'`,
        )
        .bind(
          Date.now() + 60000,
          (e as Error).message.slice(0, 500),
          Date.now(),
          row.task_id,
          row.round,
        )
        .run();
    }
  }
  const records = (
    await db
      .prepare(
        `UPDATE task_plan_records r SET locked_until=? WHERE (r.task_id,r.round,r.kind) IN
    (SELECT task_id,round,kind FROM task_plan_records WHERE content_hash IS DISTINCT FROM synced_hash AND retry_at<=? AND locked_until<?
      ORDER BY updated_at LIMIT 5 FOR UPDATE SKIP LOCKED) RETURNING task_id,round,kind,markdown,content_hash`,
      )
      .bind(Date.now() + 120000, Date.now(), Date.now())
      .all<{
        task_id: string;
        round: number;
        kind: "result" | "publish";
        markdown: string;
        content_hash: string;
      }>()
  ).results;
  for (const record of records) {
    try {
      const task = await db
        .prepare(`SELECT title FROM tasks WHERE id=?`)
        .bind(record.task_id)
        .first<{ title: string }>();
      if (!task) continue;
      await syncTaskDocument({
        taskId: record.task_id,
        round: record.round,
        title: task.title,
        markdown: record.markdown,
        kind: record.kind,
      });
      await db
        .prepare(
          `UPDATE task_plan_records SET synced_hash=?,sync_error=NULL,locked_until=0 WHERE task_id=? AND round=? AND kind=? AND content_hash=?`,
        )
        .bind(
          record.content_hash,
          record.task_id,
          record.round,
          record.kind,
          record.content_hash,
        )
        .run();
    } catch (e) {
      await db
        .prepare(
          `UPDATE task_plan_records SET sync_error=?,retry_at=?,locked_until=0 WHERE task_id=? AND round=? AND kind=?`,
        )
        .bind(
          (e as Error).message.slice(0, 500),
          Date.now() + 60000,
          record.task_id,
          record.round,
          record.kind,
        )
        .run();
    }
  }
}
