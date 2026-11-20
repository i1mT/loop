import { canTransition, isDeliveryStage, type DeliveryStage, type DeliveryState, type ReleaseTask, type Stage } from "@loop/core";
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
  repairProduction?: boolean;
}

export async function reportDelivery(leaseId: string, report: DeliveryReport): Promise<boolean> {
  if (!isDeliveryStage(report.stage) || (report.next !== report.stage && !canTransition(report.stage, report.next))) return false;
  const db = await getDb();
  const at = now();
  const lease = await db.prepare(`SELECT task_id FROM leases WHERE id=?`).bind(leaseId).first<{task_id: string}>();
  if (!lease) return false;
  const state = report.state;
  const repairProduction = report.repairProduction === true;
  const productionStage = report.stage === "production_deploy" || report.stage === "production_test";
  if (repairProduction !== (productionStage && report.next === "running") || (repairProduction && !report.repair)) return false;
  const resetTaskPr = report.next === "running" && (repairProduction || report.stage === "preview_test" || state.previewMerge === null);
  const statement = db.prepare(`WITH candidate AS (
    SELECT t.id,t.round,t.project_id,d.repo FROM tasks t JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round JOIN leases l ON l.task_id=t.id
    WHERE l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>? AND t.round=? AND t.stage=?
      AND (NOT ? OR d.state->>'productionMerge' IS NOT NULL)
      AND (NOT ? OR d.state->>'productionMerge' IS NULL)
    FOR UPDATE OF t,d,l
  ), saved AS (
    UPDATE task_delivery d SET state=d.state || ?::jsonb,next_at=? FROM candidate c
    WHERE d.task_id=c.id AND d.round=c.round RETURNING d.task_id
  ), moved AS (
    UPDATE tasks t SET stage=?,error=?,updated_at=?,round=t.round+CASE WHEN ? THEN 1 ELSE 0 END,
      merge_sha=CASE WHEN ? THEN NULL ELSE COALESCE(?,merge_sha) END,
      merged_at=CASE WHEN ? THEN NULL WHEN ?::text IS NULL THEN merged_at ELSE ? END,
      approved_sha=CASE WHEN ? THEN NULL ELSE approved_sha END,
      head_sha=CASE WHEN ? THEN NULL ELSE head_sha END,
      pr_number=CASE WHEN ? THEN NULL ELSE pr_number END, pr_url=CASE WHEN ? THEN NULL ELSE pr_url END
    FROM candidate c WHERE t.id=c.id RETURNING t.id,t.round
  ), repair_round AS (
    INSERT INTO task_delivery(task_id,round,repo,state)
    SELECT m.id,m.round,c.repo,jsonb_build_object('repairCount',?::integer,'repairReasons',?::jsonb)
    FROM moved m JOIN candidate c ON c.id=m.id WHERE ?
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
    leaseId, report.daemonId, at, report.round, report.stage, repairProduction, resetTaskPr && !repairProduction,
    JSON.stringify(state), report.delay ? at + 12_000 : 0,
    report.next, report.error?.slice(0, 3000) || null, at, repairProduction,
    repairProduction, state.productionMerge ?? null, repairProduction, state.productionMerge ?? null, at, resetTaskPr,
    report.next === "running", resetTaskPr, resetTaskPr,
    state.repairCount ?? 0, JSON.stringify(state.repairReasons ?? []), repairProduction,
    report.repair ?? null, at, report.repair ?? null, leaseId,
    state.productionMerge ?? null, JSON.stringify(state.release ?? null), JSON.stringify(state.release?.tasks ?? []), state.productionMerge ?? null,
  );
  const results = await db.batchReturning([projectLock(db, lease.task_id), notificationContext(db, lease.task_id, report.error ?? ""), statement]);
  return results[2].rowCount === 1;
}

export async function deliveryCandidates(leaseId: string, daemonId: string) {
  const db = await getDb();
  return (await db.prepare(`SELECT t.id,t.title,t.round,COALESCE(d.state->>'previewMerge',d.state->>'includedPreviewMerge') AS sha,
    CASE WHEN t.stage='running' OR d.state->>'previewMerge' IS NULL THEN 'repairing'
      WHEN t.error IS NOT NULL THEN 'failed'
      WHEN d.state->>'previewPassed'='true' THEN 'passed'
      ELSE 'pending' END AS verification,
    d.state->>'previewSha' AS "testedSha"
    FROM leases l JOIN tasks origin ON origin.id=l.task_id JOIN task_delivery od ON od.task_id=origin.id AND od.round=origin.round
    JOIN tasks t ON t.project_id=origin.project_id JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round AND d.repo=od.repo
    WHERE l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>?
    AND COALESCE(d.state->>'previewMerge',d.state->>'includedPreviewMerge') IS NOT NULL AND d.state->>'productionMerge' IS NULL
    AND t.stage IN ('running','needs_you','failed','cancelled','preview_deploy','preview_test','production_review','production_deploy')
    ORDER BY t.id`)
    .bind(leaseId, daemonId, now()).all<ReleaseTask & { sha: string }>()).results;
}

export async function previousProductionRecovery(db: Db, taskId: string, round: number) {
  return db.prepare(`SELECT round,state->>'productionMerge' AS sha,state->>'productionResult' AS result,
      state->'productionRun' AS run,state->'recovery' AS recovery
    FROM task_delivery WHERE task_id=? AND round<? AND state->>'productionMerge' IS NOT NULL ORDER BY round DESC LIMIT 1`)
    .bind(taskId, round).first<{ round: number; sha: string; result: string | null; run: DeliveryState["productionRun"]; recovery: DeliveryState["recovery"] }>();
}

export async function deliveryAction(taskId: string, action: "merge" | "retry", head?: string, number?: number, tasks?: ReleaseTask[]) {
  const db = await getDb();
  if (action === "merge") {
    if (!head || !/^[a-f0-9]{40,64}$/.test(head) || !Number.isSafeInteger(number) || number! < 1) return false;
    const statement = db.prepare(`WITH target AS (
      SELECT t.id,t.round FROM tasks t JOIN task_delivery d ON d.task_id=t.id AND d.round=t.round
      WHERE t.id=? AND t.stage='production_review' AND d.state->'release'->>'head'=? AND d.state->'release'->>'number'=?
      AND d.state->>'productionMerge' IS NULL
      AND (NOT jsonb_path_exists(d.state,'$.release.tasks[*].verification') OR d.state->'release'->'tasks'=?::jsonb) AND NOT EXISTS (
        SELECT 1 FROM tasks other JOIN task_delivery active ON active.task_id=other.id AND active.round=other.round
        WHERE other.project_id=t.project_id AND other.stage='production_deploy' AND active.repo=d.repo
        AND active.state->'release'->>'number'=d.state->'release'->>'number'
        AND active.state->>'productionMerge' IS NULL
      ) FOR UPDATE OF t,d
    ), saved AS (
      UPDATE task_delivery d SET state=d.state || jsonb_build_object('productionApproval',?::text),next_at=0
      FROM target x WHERE d.task_id=x.id AND d.round=x.round
    ) UPDATE tasks SET stage='production_deploy',error=NULL,updated_at=? WHERE id IN (SELECT id FROM target)`)
      .bind(taskId, head, String(number), JSON.stringify(tasks ?? null), head, now());
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
