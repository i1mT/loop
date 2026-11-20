import { canTransition, isDeliveryStage, type DeliveryStage, type DeliveryState, type Stage } from "@loop/core";
import { getDb, now } from "./db.ts";
import type { Db, Statement } from "./pg.ts";
import { notificationContext } from "./feishu/jobs/context.ts";

export interface DeliveryRound {
  repo: string;
  state: DeliveryState;
  next_at: number;
}

export function getDelivery(db: Db, taskId: string, round: number) {
  return db.prepare(`SELECT repo,state,next_at FROM task_delivery WHERE task_id=? AND round=?`)
    .bind(taskId, round).first<DeliveryRound>();
}

function projectLock(db: Db, taskId: string): Statement {
  return db.prepare(`SELECT pg_advisory_xact_lock(hashtextextended('delivery:' || project_id, 0)) FROM tasks WHERE id=?`).bind(taskId);
}

export interface DeliveryReport {
  daemonId: string;
  round: number;
  stage: DeliveryStage;
  next: Stage;
  state: DeliveryState;
  error?: string;
  delay?: boolean;
  repair?: string;
}

export async function reportDelivery(leaseId: string, report: DeliveryReport): Promise<boolean> {
  if (!isDeliveryStage(report.stage) || (report.next !== report.stage && !canTransition(report.stage, report.next))) return false;
  const db = await getDb();
  const at = now();
  const lease = await db.prepare(`SELECT task_id FROM leases WHERE id=?`).bind(leaseId).first<{task_id: string}>();
  if (!lease) return false;
  const state = report.state;
  const statement = db.prepare(`WITH candidate AS (
    SELECT t.id,t.round,t.project_id,d.repo FROM tasks t JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round JOIN leases l ON l.task_id=t.id
    WHERE l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>? AND t.round=? AND t.stage=?
    FOR UPDATE OF t,d,l
  ), saved AS (
    UPDATE task_delivery d SET state=d.state || ?::jsonb,next_at=? FROM candidate c
    WHERE d.task_id=c.id AND d.round=c.round RETURNING d.task_id
  ), moved AS (
    UPDATE tasks t SET stage=?,error=?,updated_at=?,
      merge_sha=COALESCE(?,merge_sha), merged_at=CASE WHEN ?::text IS NULL THEN merged_at ELSE ? END,
      head_sha=CASE WHEN ? THEN NULL ELSE head_sha END,
      pr_number=CASE WHEN ? THEN NULL ELSE pr_number END, pr_url=CASE WHEN ? THEN NULL ELSE pr_url END
    FROM candidate c WHERE t.id=c.id RETURNING t.id
  ), repair AS (
    INSERT INTO inbox(task_id,kind,body,created_at)
    SELECT id,'message',?,? FROM moved WHERE ?::text IS NOT NULL
  ), released AS (
    UPDATE leases SET released=1 WHERE id=? AND EXISTS(SELECT 1 FROM moved)
  ), included AS (
    UPDATE task_delivery d SET state=d.state || jsonb_build_object('productionMerge',?::text,'release',?::jsonb),next_at=0
    FROM candidate c JOIN tasks t ON t.project_id=c.project_id
    JOIN jsonb_to_recordset(?::jsonb) AS members(id text,round integer) ON members.id=t.id AND members.round=t.round
    WHERE ?::text IS NOT NULL AND d.repo=c.repo AND d.task_id=t.id AND d.round=t.round AND t.id<>c.id
      AND d.state->>'productionMerge' IS NULL
  ) SELECT id FROM moved`).bind(
    leaseId, report.daemonId, at, report.round, report.stage,
    JSON.stringify(state), report.delay ? at + 12_000 : 0,
    report.next, report.error?.slice(0, 3000) || null, at,
    state.productionMerge ?? null, state.productionMerge ?? null, at,
    report.next === "running", report.next === "running" && report.stage === "preview_test", report.next === "running" && report.stage === "preview_test",
    report.repair ?? null, at, report.repair ?? null, leaseId,
    state.productionMerge ?? null, JSON.stringify(state.release ?? null), JSON.stringify(state.release?.tasks ?? []), state.productionMerge ?? null,
  );
  const results = await db.batchReturning([projectLock(db, lease.task_id), notificationContext(db, lease.task_id, report.error ?? ""), statement]);
  return results[2].rowCount === 1;
}

export async function deliveryCandidates(leaseId: string, daemonId: string) {
  const db = await getDb();
  return (await db.prepare(`SELECT t.id,t.title,t.round,d.state->>'previewMerge' AS sha
    FROM leases l JOIN tasks origin ON origin.id=l.task_id JOIN task_delivery od ON od.task_id=origin.id AND od.round=origin.round
    JOIN tasks t ON t.project_id=origin.project_id JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round AND d.repo=od.repo
    WHERE l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>?
    AND d.state->>'previewMerge' IS NOT NULL AND d.state->>'productionMerge' IS NULL
    AND t.stage IN ('preview_deploy','preview_test','production_review','production_deploy')`)
    .bind(leaseId, daemonId, now()).all<{id:string; title:string; round:number; sha:string}>()).results;
}

export async function deliveryAction(taskId: string, action: "merge" | "retry", head?: string, number?: number) {
  const db = await getDb();
  if (action === "merge") {
    if (!head || !/^[a-f0-9]{40,64}$/.test(head) || !Number.isSafeInteger(number) || number! < 1) return false;
    const statement = db.prepare(`WITH target AS (
      SELECT t.id,t.round FROM tasks t JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round
      WHERE t.id=? AND t.stage='production_review' AND d.state->'release'->>'head'=? AND d.state->'release'->>'number'=?
      AND d.state->>'productionMerge' IS NULL AND NOT EXISTS (
        SELECT 1 FROM tasks other JOIN task_delivery active ON active.task_id=other.id AND active.round=other.round
        WHERE other.project_id=t.project_id AND other.stage='production_deploy' AND active.repo=d.repo
        AND active.state->'release'->>'number'=d.state->'release'->>'number'
        AND active.state->>'productionMerge' IS NULL
      ) FOR UPDATE OF t,d
    ), saved AS (
      UPDATE task_delivery d SET state=d.state || jsonb_build_object('productionApproval',?::text),next_at=0
      FROM target x WHERE d.task_id=x.id AND d.round=x.round
    ) UPDATE tasks SET stage='production_deploy',error=NULL,updated_at=? WHERE id IN (SELECT id FROM target)`)
      .bind(taskId, head, String(number), head, now());
    const results = await db.batchReturning([projectLock(db, taskId), statement]);
    return results[1].rowCount === 1;
  }
  const result = await db.prepare(`WITH ready AS (
    UPDATE tasks SET error=NULL,updated_at=? WHERE id=? AND error IS NOT NULL
    AND stage IN ('preview_deploy','preview_test','production_review','production_deploy','production_test') RETURNING id,round
  ) UPDATE task_delivery d SET next_at=0 FROM ready WHERE d.task_id=ready.id AND d.round=ready.round`)
    .bind(now(), taskId).run();
  return result.meta.changes === 1;
}
