import { getDb, now } from "./db.ts";
import { stageChange } from "./feishu/jobs/context.ts";
import { previousTaskStage, resumesClosedTask, revisesReview, startsNewRound, type ReturnStage } from "./status.ts";
import { getTask, type TaskRow } from "./tasks.ts";

/** 阶段变化与消息一同保存。发送和发布领取同时发生时，以先写入的阶段为准。 */
async function updateConversation(task: TaskRow, action: "send" | ReturnStage | "after-publish" | "clear-request", text?: string) {
  const db = await getDb();
  const stage = task.stage;
  const newRound = startsNewRound(stage, !!task.merge_sha);
  const returned = action === "development" || action === "reviewing";
  const sending = action === "send" || action === "after-publish";
  const intoDevelopment = action === "development" || (sending && (newRound || resumesClosedTask(stage) || revisesReview(stage)));
  const target = action === "reviewing" ? "reviewing" : action === "development" ? "needs_you" : intoDevelopment ? "running" : stage;
  const round = task.round + Number(newRound && intoDevelopment);
  const resetPr = round !== task.round || stage === "cancelled" || stage === "rejected";
  const release = round !== task.round || resumesClosedTask(stage) || (target === "needs_you" && returned);
  const at = now();
  const detail = returned
    ? `已回退到${target === "reviewing" ? "审核" : "开发"}${round !== task.round ? `，进入第 ${round} 轮` : ""}`
    : text ?? "发布已结束，继续处理等待中的会话消息";
  const result = await stageChange(db, db.prepare(`WITH moved AS (
    UPDATE tasks SET stage=?,round=?,updated_at=?,
      error=CASE WHEN ? THEN NULL ELSE error END,
      head_sha=CASE WHEN ? THEN NULL ELSE head_sha END,
      approved_sha=CASE WHEN ? THEN NULL ELSE approved_sha END,
      pr_number=CASE WHEN ? THEN NULL ELSE pr_number END,
      pr_url=CASE WHEN ? THEN NULL ELSE pr_url END,
      merged_at=CASE WHEN ? THEN NULL ELSE merged_at END,
      merge_sha=CASE WHEN ? THEN NULL ELSE merge_sha END,
      plan_approved=CASE WHEN ? THEN 0 ELSE plan_approved END,
      archived_at=CASE WHEN ? THEN NULL ELSE archived_at END,
      release_review=CASE WHEN ? THEN 1 ELSE release_review END
    WHERE id=? AND stage=? AND round=?
      AND (NOT ? OR EXISTS (SELECT 1 FROM inbox WHERE task_id=tasks.id AND after_publish=1 AND delivered_at IS NULL))
    RETURNING id,project_id,round
  ), message AS (
    INSERT INTO inbox(task_id,kind,body,created_at,after_publish)
    SELECT id,'message',?, ?, ? FROM moved WHERE ?::text IS NOT NULL
  ), ready AS (
    UPDATE inbox SET after_publish=0, delivered_at=CASE WHEN kind='rewind' THEN ? ELSE delivered_at END
    WHERE task_id IN (SELECT id FROM moved) AND after_publish=1 AND ?
  ), released AS (
    UPDATE leases SET released=1 WHERE task_id IN (SELECT id FROM moved) AND released=0 AND ?
  ), delivery AS (
    INSERT INTO task_delivery(task_id,round,repo)
    SELECT a.id,a.round,p.github_repo FROM moved a JOIN projects p ON p.id=a.project_id
    WHERE a.round>? AND p.delivery_settings IS NOT NULL ON CONFLICT DO NOTHING
  ), plan AS (
    INSERT INTO task_plan_rounds(task_id,round,binding_id,wiki_url,updated_at)
    SELECT a.id,a.round,COALESCE(old.binding_id,b.id),COALESCE(old.wiki_url,b.wiki_url),?
    FROM moved a JOIN projects p ON p.id=a.project_id
    LEFT JOIN task_plan_rounds old ON old.task_id=a.id AND old.round=a.round-1
    LEFT JOIN space_feishu_bindings b ON b.space_id=p.space_id AND b.enabled=1
    WHERE ? AND (COALESCE(old.binding_id,b.id) IS NOT NULL OR p.delivery_settings IS NOT NULL) ON CONFLICT(task_id,round) DO NOTHING
  ), revise_plan AS (
    UPDATE task_plan_rounds r SET phase='analyzing',revision=r.revision+1,approved_revision=NULL,
      continuation_id=NULL,sync_error=NULL,retry_at=0,locked_until=0,updated_at=?
    FROM moved WHERE r.task_id=moved.id AND r.round=moved.round AND r.phase='awaiting_review' AND ?
  ), activity AS (
    INSERT INTO notifications(task_id,kind,body,created_at)
    SELECT id,?,?,? FROM moved WHERE ?
  ) SELECT round FROM moved`).bind(
    target, round, at, intoDevelopment || returned, intoDevelopment, intoDevelopment || returned,
    resetPr, resetPr, resetPr, resetPr, round !== task.round, intoDevelopment || returned, action === "reviewing",
    task.id, stage, task.round, action === "after-publish",
    text ?? null, at, Number(stage === "publishing"), text ?? null,
    at, stage !== "publishing", release, task.round, at, round !== task.round, at, stage === "plan_reviewing" && intoDevelopment,
    returned ? "rewind" : "iterate",
    round !== task.round ? `继续开发（第 ${round} 轮）${task.pr_url ? `，上一轮 PR：${task.pr_url}` : ""}` : detail,
    at, returned || round !== task.round,
  ), task.id, detail);
  return result.rowCount === 1;
}

export async function sendTaskReply(taskId: string, text: string) {
  // 并发的阶段转换完成后，按新的阶段重新决定怎么投递，避免消息留在旧发布轮次。
  for (let attempt = 0; attempt < 3; attempt++) {
    const task = await getTask(taskId);
    if (!task) return { ok: false, status: 404, error: "任务不存在" } as const;
    if (await updateConversation(task, "send", text)) {
      const deferred = task.stage === "publishing";
      const round = task.round + Number(startsNewRound(task.stage, !!task.merge_sha));
      return { ok: true, deferred, round } as const;
    }
  }
  return { ok: false, status: 409, error: "任务状态刚刚发生变化，请再发送一次" } as const;
}

export async function rewindTask(taskId: string, target: ReturnStage) {
  const task = await getTask(taskId);
  if (!task) return { ok: false, status: 404, error: "任务不存在" } as const;
  if (previousTaskStage(task.stage, !!task.merge_sha, !!task.head_sha) === target) {
    if (task.stage === "publishing") {
      const db = await getDb();
      // 锁住任务行，确保发布结果落库前请求已经保存。重复点击只保留一条请求。
      const scheduled = await db.prepare(`WITH active AS (
        SELECT id FROM tasks WHERE id=? AND round=? AND stage='publishing' FOR UPDATE
      ), request AS (
        INSERT INTO inbox(task_id,kind,created_at,after_publish)
        SELECT id,'rewind',?,1 FROM active ON CONFLICT DO NOTHING
      ) SELECT id FROM active`).bind(task.id, task.round, now()).first();
      if (scheduled) return { ok: true, deferred: true } as const;
    } else if (await updateConversation(task, target)) {
      return { ok: true, deferred: false } as const;
    }
  }
  return { ok: false, status: 409, error: "当前阶段无法回退到这里，请刷新任务" } as const;
}

/** 发布过程中收到的修改意见，等发布结果落库后再进入开发。旧守护进程也能通过领取继续。 */
export async function resumeAfterPublish(machineId: string): Promise<void> {
  const db = await getDb();
  const task = await db.prepare(`SELECT t.*,
    EXISTS (SELECT 1 FROM inbox WHERE task_id=t.id AND after_publish=1 AND delivered_at IS NULL AND kind='message') AS "hasMessage"
    FROM tasks t WHERE t.machine_id=? AND t.stage IN ('published','publish_review','failed','reviewing','running')
      AND EXISTS (SELECT 1 FROM inbox WHERE task_id=t.id AND after_publish=1 AND delivered_at IS NULL)
    ORDER BY t.updated_at LIMIT 1`).bind(machineId).first<TaskRow & { hasMessage: boolean }>();
  if (!task) return;
  if (task.hasMessage || task.stage === "running" || task.stage === "reviewing") {
    await updateConversation(task, task.hasMessage ? "after-publish" : "clear-request");
  } else {
    await updateConversation(task, previousTaskStage(task.stage, !!task.merge_sha, !!task.head_sha) ?? "development");
  }
}

/** 工作会话同时读取已有收件箱与任务创建后发来的消息。 */
export async function pendingConversation(taskId: string, sessionId: string | null) {
  const db = await getDb();
  return (await db.prepare(`SELECT id, kind, body, option_id AS "optionId", created_at AS "createdAt"
    FROM inbox WHERE (session_id=? OR task_id=?) AND delivered_at IS NULL ORDER BY id ASC`)
    .bind(sessionId, taskId).all()).results;
}
