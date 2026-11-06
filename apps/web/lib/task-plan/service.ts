import { stageChange } from "../feishu/jobs/context.ts";
import type { Db } from "../pg.ts";
import { validatePlan, validatePlanTitle, type TechnicalPlan } from "./contract.ts";

export function taskPlanInitialization(
  db: Db,
  taskId: string,
  projectId: string,
  round = 1,
) {
  return db
    .prepare(
      `INSERT INTO task_plan_rounds(task_id,round,binding_id,wiki_url,updated_at)
    SELECT ?,?,b.id,b.wiki_url,? FROM space_feishu_bindings b JOIN projects p ON p.space_id=b.space_id
    WHERE p.id=? AND b.enabled=1 ON CONFLICT(task_id,round) DO NOTHING`,
    )
    .bind(taskId, round, Date.now(), projectId);
}
export async function initializeTaskPlan(
  db: Db,
  taskId: string,
  spaceId: string,
  round = 1,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO task_plan_rounds(task_id,round,binding_id,wiki_url,updated_at)
    SELECT ?,?,id,wiki_url,? FROM space_feishu_bindings WHERE space_id=? AND enabled=1
    ON CONFLICT(task_id,round) DO NOTHING`,
    )
    .bind(taskId, round, Date.now(), spaceId)
    .run();
}
export async function getTechnicalPlan(
  db: Db,
  taskId: string,
  round?: number,
): Promise<TechnicalPlan | null> {
  return db
    .prepare(
      `SELECT r.task_id AS "taskId",r.round,r.revision,r.phase,
    COALESCE(p.title,'') AS title,COALESCE(p.markdown,'') AS markdown,COALESCE(p.content_hash,'') AS "contentHash",
    r.baseline_head AS "baselineHead",r.document_url AS "documentUrl",r.sync_error AS "syncError",
    r.updated_at AS "updatedAt",r.continuation_id AS "continuationId"
    FROM task_plan_rounds r LEFT JOIN task_plans p ON p.task_id=r.task_id AND p.round=r.round AND p.revision=r.revision
    WHERE r.task_id=? ${round === undefined ? "" : "AND r.round=?"} ORDER BY r.round DESC LIMIT 1`,
    )
    .bind(...(round === undefined ? [taskId] : [taskId, round]))
    .first<TechnicalPlan>();
}
export async function planHistory(db: Db, taskId: string) {
  return (
    await db
      .prepare(
        `SELECT p.round,p.revision,p.title,p.markdown,p.content_hash AS "contentHash",p.created_at AS "createdAt"
    FROM task_plans p WHERE task_id=? ORDER BY round DESC,revision DESC`,
      )
      .bind(taskId)
      .all()
  ).results;
}
export async function hashContent(text: string): Promise<string> {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)),
    ),
    (v) => v.toString(16).padStart(2, "0"),
  ).join("");
}
export async function acceptTechnicalPlan(
  db: Db,
  input: {
    taskId: string;
    round: number;
    daemonId: string;
    leaseId: string;
    title: string;
    markdown: string;
    baselineHead: string;
  },
): Promise<void> {
  const title = input.title.trim();
  const invalidTitle = validatePlanTitle(title);
  if (invalidTitle) throw new Error(invalidTitle);
  const invalid = validatePlan(input.markdown);
  if (invalid) throw new Error(invalid);
  if (!/^[a-f0-9]{40,64}$/.test(input.baselineHead))
    throw new Error("工作树基线无效");
  const task = await db
    .prepare(
      `SELECT t.stage,t.round FROM tasks t JOIN leases l ON l.task_id=t.id
    WHERE t.id=? AND l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>?`,
    )
    .bind(input.taskId, input.leaseId, input.daemonId, Date.now())
    .first<{ stage: string; round: number }>();
  if (
    !task ||
    task.round !== input.round ||
    !["running", "needs_you"].includes(task.stage)
  )
    throw new Error("任务轮次或租约已失效");
  const plan = await getTechnicalPlan(db, input.taskId, input.round);
  if (!plan) throw new Error("这个任务不需要技术方案");
  const hash = await hashContent(input.markdown);
  if (plan.contentHash === hash && plan.phase !== "analyzing") return;
  if (plan.phase !== "analyzing")
    throw new Error("方案已经提交，不能覆盖已审核或正在同步的版本");
  const at = Date.now();
  const leaseGuard = `EXISTS(SELECT 1 FROM tasks t JOIN leases l ON l.task_id=t.id WHERE t.id=task_plan_rounds.task_id AND t.round=task_plan_rounds.round AND t.stage IN ('running','needs_you') AND l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>? FOR UPDATE OF t,l)`;
  const guardParams = [input.leaseId, input.daemonId, at];
  await db.batch([
    db
      .prepare(
        `INSERT INTO task_plans(task_id,round,revision,title,markdown,content_hash,created_at)
      SELECT task_id,round,revision,?,?,?,? FROM task_plan_rounds WHERE task_id=? AND round=? AND phase='analyzing' AND ${leaseGuard}
      ON CONFLICT(task_id,round,revision) DO NOTHING`,
      )
      .bind(
        title,
        input.markdown,
        hash,
        at,
        input.taskId,
        input.round,
        ...guardParams,
      ),
    db
      .prepare(
        `UPDATE task_plan_rounds SET phase='syncing',baseline_head=?,sync_error=NULL,retry_at=0,updated_at=?
      WHERE task_id=? AND round=? AND phase='analyzing' AND ${leaseGuard}`,
      )
      .bind(input.baselineHead, at, input.taskId, input.round, ...guardParams),
  ]);
  const saved = await getTechnicalPlan(db, input.taskId, input.round);
  if (saved?.contentHash !== hash || saved.phase !== "syncing")
    throw new Error("方案版本发生冲突，请重新读取");
}
export async function approveTechnicalPlan(
  db: Db,
  taskId: string,
  revision?: number,
  note = "",
): Promise<boolean> {
  const at = Date.now();
  const result = await stageChange(db, db.prepare(
      `WITH candidate AS (
    SELECT t.id,t.round FROM tasks t JOIN task_plan_rounds r ON r.task_id=t.id AND r.round=t.round
    WHERE t.id=? AND t.stage='plan_reviewing' AND r.phase='awaiting_review' AND r.document_url IS NOT NULL
    ${revision === undefined ? "" : "AND r.revision=?"} FOR UPDATE OF t,r
  ), approved AS (
    UPDATE task_plan_rounds r SET phase='implementing',approved_revision=revision,
      continuation_id=r.task_id || ':' || r.round || ':' || r.revision,updated_at=?
    FROM candidate c WHERE r.task_id=c.id AND r.round=c.round RETURNING r.task_id,r.round
  ) UPDATE tasks t SET plan_approved=1,stage='plan_approved',updated_at=? FROM approved a
    WHERE t.id=a.task_id AND t.round=a.round AND t.stage='plan_reviewing'`,
    )
    .bind(taskId, ...(revision === undefined ? [] : [revision]), at, at)
    ,taskId,note);
  return result.rowCount === 1;
}
export async function retryTechnicalPlan(
  db: Db,
  taskId: string,
): Promise<void> {
  await db.batch([
    db
      .prepare(
        `UPDATE task_plan_rounds SET retry_at=0,locked_until=0,sync_error=NULL WHERE task_id=? AND phase='syncing'`,
      )
      .bind(taskId),
    db
      .prepare(
        `UPDATE task_plan_records SET retry_at=0,locked_until=0,sync_error=NULL WHERE task_id=?`,
      )
      .bind(taskId),
  ]);
}
export async function recordTaskResult(
  db: Db,
  taskId: string,
  kind: "result" | "publish",
  markdown: string,
): Promise<void> {
  if (!(await getTechnicalPlan(db, taskId))) return;
  const content = markdown.slice(0, 60000);
  await db
    .prepare(
      `INSERT INTO task_plan_records(task_id,round,kind,markdown,content_hash,updated_at)
    SELECT id,round,?,?,?,? FROM tasks WHERE id=? ON CONFLICT(task_id,round,kind) DO UPDATE
    SET markdown=EXCLUDED.markdown,content_hash=EXCLUDED.content_hash,retry_at=0,updated_at=EXCLUDED.updated_at`,
    )
    .bind(kind, content, await hashContent(content), Date.now(), taskId)
    .run();
}

/** 保存人工修订，旧版本保持不变；任何已开始实现的方案不能被覆盖。 */
export async function reviseTechnicalPlan(
  db: Db,
  taskId: string,
  revision: number,
  markdown: string,
): Promise<void> {
  const invalid = validatePlan(markdown);
  if (invalid) throw new Error(invalid);
  if (!Number.isInteger(revision)) throw new Error("需要当前方案版本");
  const hash = await hashContent(markdown),
    at = Date.now();
  const saved = await db
    .prepare(
      `WITH candidate AS (
    SELECT r.task_id,r.round FROM task_plan_rounds r JOIN tasks t ON t.id=r.task_id AND t.round=r.round
    WHERE r.task_id=? AND r.revision=? AND (r.phase='awaiting_review' OR (r.phase='syncing' AND r.sync_error IS NOT NULL))
      AND r.locked_until<? AND t.stage IN ('running','needs_you','plan_reviewing') FOR UPDATE OF t,r
  ), advanced AS (
    UPDATE task_plan_rounds r SET revision=r.revision+1,phase='syncing',approved_revision=NULL,continuation_id=NULL,
      sync_error=NULL,retry_at=0,updated_at=? FROM candidate c WHERE r.task_id=c.task_id AND r.round=c.round
    RETURNING r.task_id,r.round,r.revision
  ) INSERT INTO task_plans(task_id,round,revision,title,markdown,content_hash,created_at)
    SELECT task_id,round,revision,
      COALESCE((SELECT p.title FROM task_plans p WHERE p.task_id=advanced.task_id AND p.round=advanced.round ORDER BY p.revision DESC LIMIT 1),''),
      ?,?,? FROM advanced RETURNING revision`,
    )
    .bind(taskId, revision, at, at, markdown, hash, at)
    .first<{ revision: number }>();
  if (!saved) throw new Error("方案版本或执行状态发生变化，请刷新后重新修改");
}

export async function acceptImplementationRecord(
  db: Db,
  input: {
    taskId: string;
    round: number;
    daemonId: string;
    leaseId: string;
    markdown: string;
  },
): Promise<void> {
  const content = input.markdown.slice(0, 60000),
    at = Date.now();
  const result = await db
    .prepare(
      `WITH permitted AS (
    SELECT t.id,t.round FROM tasks t JOIN leases l ON l.task_id=t.id JOIN task_plan_rounds r ON r.task_id=t.id AND r.round=t.round
    WHERE t.id=? AND t.round=? AND l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>?
      AND t.stage IN ('running','needs_you','reviewing','approved','publishing') AND r.phase='implementing'
      FOR UPDATE OF t,l,r
  ) INSERT INTO task_plan_records(task_id,round,kind,markdown,content_hash,updated_at)
    SELECT id,round,'result',?,?,? FROM permitted ON CONFLICT(task_id,round,kind) DO UPDATE
    SET markdown=EXCLUDED.markdown,content_hash=EXCLUDED.content_hash,retry_at=0,updated_at=EXCLUDED.updated_at RETURNING task_id`,
    )
    .bind(
      input.taskId,
      input.round,
      input.leaseId,
      input.daemonId,
      at,
      content,
      await hashContent(content),
      at,
    )
    .first();
  if (!result) throw new Error("任务轮次、实现阶段或租约已失效");
}
