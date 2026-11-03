// 守护进程协议的服务端实现（见 docs/contracts/daemon-protocol.md）。
import { parseSessionEvent } from "@loop/core";
import { canTransition, type Stage } from "@loop/core";
import { getDb, now, newId } from "./db.ts";
import {
  getProject,
  getTask,
  notify,
  setStage,
  type TaskRow,
} from "./tasks.ts";
import { touchMachine } from "./machines.ts";
import { nextTaskStage, type SessionState } from "./session-stage.ts";
import {
  approveTechnicalPlan,
  getTechnicalPlan,
  recordTaskResult,
} from "./task-plan/service.ts";
import {
  canIterate,
  canOverrideOutcome,
  canRepublish,
  canRestore,
  STAGE_LABEL,
} from "./status.ts";

export const LEASE_MS = 60_000;

/** 领取：优先给本守护进程原有的租约（断线重连）；其次排队中的任务；再次是已批准待发布的任务；最后接管过期的运行中/发布中任务 */
export async function claim(
  daemonId: string,
  holding: string[] = [],
  supportsTechnicalPlan = false,
): Promise<{
  task: Record<string, unknown>;
  leaseId: string;
  expiresAt: number;
} | null> {
  const db = await getDb();
  const t = now();
  const supported = supportsTechnicalPlan
    ? ""
    : " AND NOT EXISTS (SELECT 1 FROM task_plan_rounds r WHERE r.task_id=t.id AND r.round=t.round)";
  await touchMachine(db, daemonId); // 每次领取都刷新在线状态
  const mine = await db
    .prepare(
      `SELECT t.* , l.id AS lease_id FROM leases l JOIN tasks t ON t.id = l.task_id
       WHERE l.daemon_id=? AND l.released=0 AND l.expires_at>? AND t.stage NOT IN ('published', 'rejected', 'failed', 'cancelled')${holding.length ? ` AND t.id NOT IN (${holding.map(() => "?").join(",")})` : ""}
       ${supported}
       ORDER BY l.expires_at DESC LIMIT 1`,
    )
    .bind(daemonId, t, ...holding)
    .first<TaskRow & { lease_id: string }>();
  let task: TaskRow | null = mine ?? null;
  const reattach = !!mine;
  if (!task) {
    // 第三种：已进入待审核却还没回传过提交（推送/建 PR 失败后租约又丢了）——重新领回去补发，否则改动会永远留在本机
    const q = await db
      .prepare(
        `SELECT t.* FROM tasks t
         WHERE t.machine_id = ?
           AND (t.stage IN ('queued', 'approved')
             OR (t.stage IN ('running', 'publishing') AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.task_id=t.id AND l.released=0 AND l.expires_at>?))
             OR (t.stage = 'reviewing' AND t.head_sha IS NULL AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.task_id=t.id AND l.released=0 AND l.expires_at>?)))
         ${supported}
         ORDER BY CASE WHEN t.stage='approved' THEN 0 WHEN t.priority='urgent' THEN 0 ELSE 1 END, t.created_at ASC LIMIT 1`,
      )
      .bind(daemonId, t, t)
      .first<TaskRow>();
    task = q ?? null;
  }
  if (!task) return null;

  let leaseId: string;
  const expiresAt = t + LEASE_MS;
  if (reattach) {
    leaseId = (mine as TaskRow & { lease_id: string }).lease_id;
    await db
      .prepare(`UPDATE leases SET expires_at=? WHERE id=?`)
      .bind(expiresAt, leaseId)
      .run();
  } else {
    // 本机已经持有这个任务的有效租约（例如工作会话在等审核，批准后轮到发布）：沿用它，
    // 不作废重发，否则守护进程会把仍在管理的工作会话当成“被收回”而取消。
    const own = await db
      .prepare(
        `SELECT id FROM leases WHERE task_id=? AND daemon_id=? AND released=0 AND expires_at>? ORDER BY expires_at DESC LIMIT 1`,
      )
      .bind(task.id, daemonId, t)
      .first<{ id: string }>();
    if (own) {
      leaseId = own.id;
      await db
        .prepare(`UPDATE leases SET expires_at=? WHERE id=?`)
        .bind(expiresAt, leaseId)
        .run();
    } else {
      await db
        .prepare(`UPDATE leases SET released=1 WHERE task_id=? AND released=0`)
        .bind(task.id)
        .run();
      leaseId = newId();
      await db
        .prepare(
          `INSERT INTO leases (id, task_id, daemon_id, expires_at) VALUES (?, ?, ?, ?)`,
        )
        .bind(leaseId, task.id, daemonId, expiresAt)
        .run();
    }
    if (task.stage === "queued") await setStage(task.id, "running");
  }
  // 已批准的任务，无论是新领取还是同一守护进程接管，本次都是发布任务
  if (task.stage === "approved") {
    await setStage(task.id, "publishing");
    task = { ...task, stage: "publishing" };
  }
  const job =
    task.stage === "publishing" || task.stage === "approved"
      ? "publish"
      : "work";
  const project = await getProject(task.project_id);
  const session = await db
    .prepare(
      `SELECT id FROM sessions WHERE task_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(task.id)
    .first<{ id: string }>();
  return {
    leaseId,
    expiresAt,
    task: {
      id: task.id,
      title: task.title,
      body: task.body,
      agent: task.agent,
      model: task.model,
      effort: task.effort,
      instructions: project?.instructions ?? null,
      repoPath: project?.local_path ?? null,
      githubRepo: project?.github_repo ?? null,
      mainRef: project?.main_ref ?? "main",
      branch: task.branch,
      prNumber: task.pr_number,
      prUrl: task.pr_url,
      attributes: {
        releaseReview: !!task.release_review,
        planReview: !!task.plan_review,
        batchEligible: !!task.batch_eligible,
        previewSlot: task.preview_slot,
        priority: task.priority,
      },
      sessionId: session?.id ?? null,
      reattach,
      job,
      approvedSha: task.approved_sha,
      round: task.round ?? 1,
      technicalPlan: await getTechnicalPlan(db, task.id, task.round ?? 1).then(
        (p) =>
          p
            ? {
                required: true,
                phase: p.phase,
                revision: p.revision,
                documentUrl: p.documentUrl,
              }
            : null,
      ),
    },
  };
}

export async function heartbeat(
  leaseId: string,
  daemonId: string,
): Promise<
  | { ok: true; expiresAt: number; stage: Stage | null }
  | { ok: false; status: number; error: string }
> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT * FROM leases WHERE id=?`)
    .bind(leaseId)
    .first<{ daemon_id: string; released: number; expires_at: number }>();
  if (
    !lease ||
    lease.released ||
    lease.expires_at < now() ||
    lease.daemon_id !== daemonId
  )
    return { ok: false, status: 409, error: "租约已失效" };
  const expiresAt = now() + LEASE_MS;
  await db
    .prepare(`UPDATE leases SET expires_at=? WHERE id=?`)
    .bind(expiresAt, leaseId)
    .run();
  // 带回任务阶段：被人驳回或取消后，守护进程据此收尾（关闭 PR、清理 worktree、释放租约）
  const t = await db
    .prepare(
      `SELECT stage FROM tasks WHERE id=(SELECT task_id FROM leases WHERE id=?)`,
    )
    .bind(leaseId)
    .first<{ stage: Stage }>();
  return { ok: true, expiresAt, stage: t?.stage ?? null };
}

/** 守护进程收尾完成后释放租约（只允许在任务已结束时） */
export async function releaseLease(
  leaseId: string,
  daemonId: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT task_id, daemon_id FROM leases WHERE id=?`)
    .bind(leaseId)
    .first<{ task_id: string; daemon_id: string }>();
  if (!lease || lease.daemon_id !== daemonId)
    return { ok: false, status: 409, error: "租约不属于该守护进程" };
  const t = await getTask(lease.task_id);
  if (!t || !["rejected", "cancelled", "failed", "published"].includes(t.stage))
    return { ok: false, status: 409, error: "任务还没有结束，不能释放租约" };
  await db
    .prepare(`UPDATE leases SET released=1 WHERE id=?`)
    .bind(leaseId)
    .run();
  return { ok: true, status: 200 };
}

/** 校验租约仍有效并且属于这个任务、这个守护进程 */
async function checkLease(
  leaseId: string,
  daemonId: string,
  taskId: string,
): Promise<boolean> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT * FROM leases WHERE id=? AND task_id=?`)
    .bind(leaseId, taskId)
    .first<{ daemon_id: string; released: number; expires_at: number }>();
  return (
    !!lease &&
    !lease.released &&
    lease.expires_at >= now() &&
    lease.daemon_id === daemonId
  );
}

async function ensureSession(
  sessionId: string,
  taskId: string,
  agent: string,
): Promise<void> {
  const db = await getDb();
  const t = now();
  await db
    .prepare(
      `INSERT INTO sessions (id, task_id, agent, state, created_at, updated_at) VALUES (?, ?, ?, 'starting', ?, ?) ON CONFLICT (id) DO NOTHING`,
    )
    .bind(sessionId, taskId, agent, t, t)
    .run();
}

/**
 * 按会话状态推进任务阶段，并处理阶段变化的副作用：
 * - 需要你：记通知
 * - 待审核：记通知；若任务不需要发布审核（属性 release_review=0），直接批准
 */
export async function transitionTo(
  taskId: string,
  state: SessionState,
): Promise<{ stage: Stage; rejected: boolean }> {
  const task = await getTask(taskId);
  if (!task) return { stage: "failed", rejected: true };
  const technicalPlan = await getTechnicalPlan(
    await getDb(),
    taskId,
    task.round ?? 1,
  );
  if (
    technicalPlan &&
    technicalPlan.phase !== "implementing" &&
    state === "idle"
  )
    return { stage: task.stage, rejected: false };
  // 需要方案审核、且方案还没批准：这一轮结束时只是交出方案，进入方案审核
  if (
    state === "idle" &&
    task.stage === "running" &&
    task.plan_review &&
    !task.plan_approved
  ) {
    await setStage(taskId, "plan_reviewing");
    await notify(taskId, "plan_reviewing", "方案已产出，等待你批准后再实现");
    return { stage: "plan_reviewing", rejected: false };
  }
  // 审核已通过、正在发布：阶段只由发布结果推进，会话事件（迟到的 idle、被取消等）不能改动
  if (task.stage === "approved" || task.stage === "publishing")
    return { stage: task.stage, rejected: false };
  const r = nextTaskStage(task.stage, state);
  if (r.stage === task.stage) return r;
  await setStage(taskId, r.stage);
  if (r.stage === "needs_you")
    await notify(taskId, "needs_you", "会话需要你决定");
  if (r.stage === "reviewing") {
    await notify(taskId, "reviewing", "一轮已结束，等待审核");
    if (!task.release_review) await approveTask(taskId, "auto");
  }
  return r;
}

/** 方案审核：批准后把"按方案实现"发给会话；驳回则任务结束 */
export async function decidePlan(
  taskId: string,
  decision: "approve" | "reject",
  reason: string,
  revision?: number,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.stage !== "plan_reviewing")
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能审核方案`,
    };
  const db = await getDb();
  if (decision === "reject") {
    await setStage(taskId, "rejected");
    await notify(taskId, "rejected", `方案已驳回：${reason || "无说明"}`);
    return { ok: true };
  }
  const technicalPlan = await getTechnicalPlan(db, taskId, task.round ?? 1);
  if (technicalPlan) {
    if (revision === undefined || revision !== technicalPlan.revision)
      return { ok: false, error: "方案版本发生变化，请刷新后重新审核" };
    if (!(await approveTechnicalPlan(db, taskId, revision)))
      return { ok: false, error: "方案尚未保存完成或审核状态已经变化" };
    await notify(taskId, "plan_approved", "方案已批准，开始实现");
    return { ok: true };
  }
  await db
    .prepare(
      `UPDATE tasks SET plan_approved=1, stage='plan_approved', updated_at=? WHERE id=?`,
    )
    .bind(now(), taskId)
    .run();
  await notify(taskId, "plan_approved", "方案已批准，开始实现");
  const s = await db
    .prepare(
      `SELECT id FROM sessions WHERE task_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(taskId)
    .first<{ id: string }>();
  if (s) {
    await db
      .prepare(
        `INSERT INTO inbox (session_id, kind, body, created_at) VALUES (?, 'message', ?, ?)`,
      )
      .bind(
        s.id,
        "方案已通过。请严格按你刚才给出的方案实现，完成后给出交付报告。",
        now(),
      )
      .run();
  }
  return { ok: true };
}

export interface IngestResult {
  ok: boolean;
  status: number;
  error?: string;
  accepted?: number;
  rejectedStageChanges?: number;
}

/** 批量写入事件：按 (session_id, seq) 幂等；每条都用 @loop/core 校验；status 事件驱动任务阶段 */
export async function ingestEvents(
  sessionId: string,
  leaseId: string,
  daemonId: string,
  raw: { seq: number; kind: string; payload: unknown; at: number }[],
): Promise<IngestResult> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT task_id FROM leases WHERE id=?`)
    .bind(leaseId)
    .first<{ task_id: string }>();
  if (!lease) return { ok: false, status: 409, error: "租约不存在" };
  if (!(await checkLease(leaseId, daemonId, lease.task_id)))
    return { ok: false, status: 409, error: "租约已失效，停止写入" };
  const taskRow = await getTask(lease.task_id);
  await ensureSession(sessionId, lease.task_id, taskRow?.agent ?? "unknown");

  const events = [];
  for (const e of raw) {
    const parsed = parseSessionEvent({
      seq: e.seq,
      sessionId,
      at: e.at,
      kind: e.kind,
      payload: e.payload,
    });
    if (!parsed.ok)
      return {
        ok: false,
        status: 400,
        error: `非法事件 seq=${e.seq}：${parsed.error}`,
      };
    events.push(parsed.event);
  }
  let rejectedStageChanges = 0;
  // 批量写入：每 100 条一次往返（逐条写入时，一轮几百个事件会拖上百秒）。
  // RETURNING 只返回真正新写入的事件：重复发送（超时重试）的事件不会再次触发阶段转换。
  const inserted = new Set<number>();
  for (let i = 0; i < events.length; i += 100) {
    const chunk = events.slice(i, i + 100);
    const params: unknown[] = [];
    const values = chunk
      .map((ev) => {
        params.push(
          sessionId,
          ev.seq,
          ev.kind,
          JSON.stringify(ev.payload),
          ev.at,
        );
        return "(?, ?, ?, ?, ?)";
      })
      .join(", ");
    const rows = (
      await db
        .prepare(
          `INSERT INTO session_events (session_id, seq, kind, payload, at) VALUES ${values} ON CONFLICT (session_id, seq) DO NOTHING RETURNING seq`,
        )
        .bind(...params)
        .all<{ seq: number }>()
    ).results;
    for (const r of rows) inserted.add(Number(r.seq));
  }
  for (const ev of events) {
    if (ev.kind !== "status" || !inserted.has(ev.seq)) continue;
    const state = (ev.payload as { state: SessionState }).state;
    await db
      .prepare(`UPDATE sessions SET state=?, updated_at=? WHERE id=?`)
      .bind(state, now(), sessionId)
      .run();
    const r = await transitionTo(lease.task_id, state);
    if (r.rejected) rejectedStageChanges++;
  }
  return {
    ok: true,
    status: 200,
    accepted: events.length,
    rejectedStageChanges,
  };
}

export async function updateSessionState(
  sessionId: string,
  state: SessionState,
  leaseId: string,
  daemonId: string,
): Promise<IngestResult> {
  const db = await getDb();
  const row = await db
    .prepare(`SELECT task_id FROM sessions WHERE id=?`)
    .bind(sessionId)
    .first<{ task_id: string }>();
  if (!row) return { ok: false, status: 404, error: "会话不存在" };
  if (!(await checkLease(leaseId, daemonId, row.task_id)))
    return { ok: false, status: 409, error: "租约已失效" };
  await db
    .prepare(`UPDATE sessions SET state=?, updated_at=? WHERE id=?`)
    .bind(state, now(), sessionId)
    .run();
  const r = await transitionTo(row.task_id, state);
  return { ok: true, status: 200, rejectedStageChanges: r.rejected ? 1 : 0 };
}

/** 守护进程报告当前提交（审核的对象）。只在任务待审核时有意义，其它阶段仅记录。 */
export interface PrInfo {
  branch?: string | null;
  prNumber?: number | null;
  prUrl?: string | null;
}

export async function reportHead(
  sessionId: string,
  leaseId: string,
  daemonId: string,
  head: string,
  pr: PrInfo = {},
): Promise<IngestResult> {
  if (!/^[0-9a-f]{7,40}$/.test(head))
    return { ok: false, status: 400, error: "head 必须是提交哈希" };
  const db = await getDb();
  const row = await db
    .prepare(`SELECT task_id FROM sessions WHERE id=?`)
    .bind(sessionId)
    .first<{ task_id: string }>();
  if (!row) return { ok: false, status: 404, error: "会话不存在" };
  if (!(await checkLease(leaseId, daemonId, row.task_id)))
    return { ok: false, status: 409, error: "租约已失效" };
  // 只在工作相关阶段接受提交回传：发布或已批准之后，头提交不能再被改写（审核对象已经固定）
  const current = await getTask(row.task_id);
  if (
    !current ||
    !["running", "reviewing", "needs_you"].includes(current.stage)
  )
    return { ok: true, status: 200 };
  const technicalPlan = await getTechnicalPlan(
    db,
    current.id,
    current.round ?? 1,
  );
  if (technicalPlan && technicalPlan.phase !== "implementing")
    return {
      ok: false,
      status: 409,
      error: "技术方案尚未保存或通过审核，不能回传实现提交",
    };
  await db
    .prepare(
      `UPDATE tasks SET head_sha=?, branch=COALESCE(?, branch), pr_number=COALESCE(?, pr_number), pr_url=COALESCE(?, pr_url), updated_at=? WHERE id=?`,
    )
    .bind(
      head,
      pr.branch ?? null,
      pr.prNumber ?? null,
      pr.prUrl ?? null,
      now(),
      row.task_id,
    )
    .run();
  // 自动批准的任务可能先于提交回传进入待审核：此时补做一次批准
  const task = await getTask(row.task_id);
  if (task && task.stage === "reviewing" && !task.release_review)
    await approveTask(row.task_id, "auto");
  return { ok: true, status: 200 };
}

/** 审核：批准 = 记下当前审核的提交，进入"已通过"；发布时必须是同一个提交 */
export async function approveTask(
  taskId: string,
  by: "admin" | "auto",
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.stage !== "reviewing")
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能批准`,
    };
  if (!task.head_sha) return { ok: false, error: "还没有可审核的提交" };
  const db = await getDb();
  await db
    .prepare(
      `UPDATE tasks SET approved_sha=?, stage='approved', updated_at=? WHERE id=?`,
    )
    .bind(task.head_sha, now(), taskId)
    .run();
  await notify(
    taskId,
    "approved",
    by === "auto"
      ? `无需发布审核，已自动批准（${task.head_sha.slice(0, 8)}）`
      : `已批准发布（${task.head_sha.slice(0, 8)}）`,
  );
  return { ok: true };
}

export async function rejectTask(
  taskId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.stage !== "reviewing")
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能驳回`,
    };
  await setStage(taskId, "rejected");
  await notify(taskId, "rejected", `已驳回：${reason || "无说明"}`);
  return { ok: true };
}

/** 取消任务：除发布中与已结束外的任何阶段都可以取消。已有会话的由守护进程在下一次心跳时收尾。 */
export async function cancelTask(
  taskId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (!canTransition(task.stage, "cancelled"))
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能取消`,
    };
  await setStage(taskId, "cancelled");
  await notify(taskId, "cancelled", `已取消${reason ? `：${reason}` : ""}`);
  return { ok: true };
}

/**
 * 发布任务的结果。
 * - published：智能体明确说发布成功，任务结束
 * - agent_done：PR 已合并，发布智能体已结束但没有给出明确结论，等人确认结果（publish_review）
 * - failed：合并或发布流程出错，任务结束（可由人重开）
 * - review_needed：发布前发现提交已变（主分支前进），回到待审核，需要人重新批准
 */
export async function completePublish(
  leaseId: string,
  daemonId: string,
  outcome: "published" | "agent_done" | "failed" | "review_needed",
  output: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT task_id FROM leases WHERE id=?`)
    .bind(leaseId)
    .first<{ task_id: string }>();
  if (!lease) return { ok: false, status: 409, error: "租约不存在" };
  if (!(await checkLease(leaseId, daemonId, lease.task_id)))
    return { ok: false, status: 409, error: "租约已失效" };
  const task = await getTask(lease.task_id);
  if (!task || task.stage !== "publishing")
    return { ok: false, status: 409, error: "任务不在发布中" };
  // 需要重新审核时租约保留：工作区仍属于这个守护进程，待审核后直接继续（否则工作会话会被当作租约被收回）
  await recordTaskResult(
    db,
    task.id,
    "publish",
    `## 发布结果\n\n${outcome}\n\n${output.slice(-20000)}`,
  );
  const tail = output.slice(-400);
  if (outcome === "published") {
    await db
      .prepare(
        `UPDATE tasks SET error=NULL, stage='published', updated_at=? WHERE id=?`,
      )
      .bind(now(), task.id)
      .run();
    await notify(task.id, "published", `已发布：${tail}`);
  } else if (outcome === "agent_done") {
    // 智能体的发布总结放在 error 列里供确认页展示（确认成功时清掉）
    await db
      .prepare(
        `UPDATE tasks SET error=?, stage='publish_review', updated_at=? WHERE id=?`,
      )
      .bind(output.slice(-2000), now(), task.id)
      .run();
    await notify(task.id, "publish_review", "智能体已结束发布，请确认发布结果");
  } else if (outcome === "failed") {
    await db
      .prepare(
        `UPDATE tasks SET error=?, stage='failed', updated_at=? WHERE id=?`,
      )
      .bind(tail, now(), task.id)
      .run();
    await notify(task.id, "failed", `发布失败：${tail}`);
  } else {
    await db
      .prepare(
        `UPDATE tasks SET approved_sha=NULL, stage='reviewing', updated_at=? WHERE id=?`,
      )
      .bind(now(), task.id)
      .run();
    await notify(
      task.id,
      "reviewing",
      `发布前发现提交已变，需要重新审核：${tail}`,
    );
  }
  if (outcome !== "review_needed")
    await db.prepare(`UPDATE leases SET released=1 WHERE id=?`).bind(leaseId).run();
  return { ok: true, status: 200 };
}

/** 人确认发布结果：成功 → published；失败 → failed（记下原因） */
export async function confirmPublish(
  taskId: string,
  ok: boolean,
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (task.stage !== "publish_review")
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能确认发布结果`,
    };
  const db = await getDb();
  if (ok) {
    await db
      .prepare(
        `UPDATE tasks SET error=NULL, stage='published', updated_at=? WHERE id=?`,
      )
      .bind(now(), taskId)
      .run();
    await notify(taskId, "published", "已确认发布成功");
  } else {
    await db
      .prepare(
        `UPDATE tasks SET error=?, stage='failed', updated_at=? WHERE id=?`,
      )
      .bind(note || "人工确认发布失败", now(), taskId)
      .run();
    await notify(taskId, "failed", `已确认发布失败${note ? `：${note}` : ""}`);
  }
  return { ok: true };
}

/**
 * 人工改写任务结果：自动判断不准时（例如合并 PR 会自动触发部署，但发布步骤因缺少约定报了失败），由人把结果改成已发布。
 * 只允许在发布环节与失败态之间改；会释放租约，让守护进程停止管理。
 */
export async function overrideOutcome(
  taskId: string,
  to: "published" | "failed",
  note: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (!canOverrideOutcome(task.stage))
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能手动改结果`,
    };
  if (task.stage === to) return { ok: false, error: "已经是这个状态" };
  const db = await getDb();
  await db
    .prepare(`UPDATE leases SET released=1 WHERE task_id=? AND released=0`)
    .bind(taskId)
    .run();
  if (to === "published") {
    await db
      .prepare(
        `UPDATE tasks SET error=NULL, stage='published', updated_at=? WHERE id=?`,
      )
      .bind(now(), taskId)
      .run();
    await notify(
      taskId,
      "published",
      `人工标记为已发布${note ? `：${note}` : ""}`,
    );
  } else {
    await db
      .prepare(
        `UPDATE tasks SET error=?, stage='failed', updated_at=? WHERE id=?`,
      )
      .bind(note || "人工标记为失败", now(), taskId)
      .run();
    await notify(taskId, "failed", `人工标记为失败${note ? `：${note}` : ""}`);
  }
  return { ok: true };
}

export async function undeliveredInbox(
  sessionId: string,
  after: number,
): Promise<
  {
    id: number;
    kind: string;
    body: string | null;
    requestId: string | null;
    optionId: string | null;
  }[]
> {
  const db = await getDb();
  return (
    await db
      .prepare(
        `SELECT id, kind, body, request_id AS "requestId", option_id AS "optionId" FROM inbox WHERE session_id=? AND delivered_at IS NULL AND id>? ORDER BY id ASC`,
      )
      .bind(sessionId, after)
      .all<{
        id: number;
        kind: string;
        body: string | null;
        requestId: string | null;
        optionId: string | null;
      }>()
  ).results;
}

export async function ackInbox(itemId: number): Promise<void> {
  const db = await getDb();
  await db
    .prepare(
      `UPDATE inbox SET delivered_at=? WHERE id=? AND delivered_at IS NULL`,
    )
    .bind(now(), itemId)
    .run();
}

/** 最近一个尚未决定的权限请求（人类回答时不必知道内部 requestId） */
export async function pendingPermission(
  sessionId: string,
): Promise<string | null> {
  const db = await getDb();
  const rows = (
    await db
      .prepare(
        `SELECT kind, payload FROM session_events WHERE session_id=? AND kind IN ('permission_request','permission_resolved') ORDER BY seq ASC`,
      )
      .bind(sessionId)
      .all<{ kind: string; payload: string }>()
  ).results;
  const open: string[] = [];
  for (const r of rows) {
    const id = (JSON.parse(r.payload) as { requestId: string }).requestId;
    if (r.kind === "permission_request") open.push(id);
    else {
      const i = open.indexOf(id);
      if (i >= 0) open.splice(i, 1);
    }
  }
  return open.length ? open[open.length - 1] : null;
}

/** 人类回复：投递到该任务最近的会话收件箱 */
export async function enqueueForTask(
  taskId: string,
  item: {
    kind: "message" | "decision" | "republish";
    body?: string;
    requestId?: string;
    optionId?: string;
  },
): Promise<{ ok: boolean; error?: string }> {
  const db = await getDb();
  const s = await db
    .prepare(
      `SELECT id FROM sessions WHERE task_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(taskId)
    .first<{ id: string }>();
  if (!s) return { ok: false, error: "该任务还没有会话" };
  if (item.kind === "decision" && !item.requestId) {
    const pending = await pendingPermission(s.id);
    if (pending) item.requestId = pending;
    else if ((await getTask(taskId))?.stage !== "needs_you")
      return { ok: false, error: "当前没有需要回答的问题（可能已经回答过了）" };
  }
  await db
    .prepare(
      `INSERT INTO inbox (session_id, kind, body, request_id, option_id, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      s.id,
      item.kind,
      item.body ?? null,
      item.requestId ?? null,
      item.optionId ?? null,
      now(),
    )
    .run();
  return { ok: true };
}

/** 领取后无法启动：释放租约，任务进入 failed（终态，需人工重开） */
export async function failLease(
  leaseId: string,
  daemonId: string,
  reason: string,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const db = await getDb();
  const lease = await db
    .prepare(`SELECT * FROM leases WHERE id=?`)
    .bind(leaseId)
    .first<{ task_id: string; daemon_id: string; released: number }>();
  if (!lease || lease.daemon_id !== daemonId)
    return { ok: false, status: 409, error: "租约不属于该守护进程" };
  await db
    .prepare(`UPDATE leases SET released=1 WHERE id=?`)
    .bind(leaseId)
    .run();
  await db
    .prepare(
      `UPDATE tasks SET error=?, stage='failed', updated_at=? WHERE id=?`,
    )
    .bind(reason, now(), lease.task_id)
    .run();
  await notify(lease.task_id, "failed", `启动失败：${reason}`);
  return { ok: true, status: 200 };
}

/** 让守护进程立刻重新推送分支并创建 PR（待审核却还没有 PR 时）。PR 由守护进程用 gh 创建，不是智能体。 */
export async function republishTask(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (!canRepublish(task.stage, !!task.pr_url))
    return {
      ok: false,
      error: task.pr_url
        ? "PR 已经创建了"
        : `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能重新创建 PR`,
    };
  const r = await enqueueForTask(taskId, { kind: "republish" });
  if (r.ok)
    await notify(taskId, "republish", "已请求守护进程重新推送并创建 PR");
  return r;
}

/**
 * 人工把取消/驳回/失败的任务改回“待审核”：清掉提交与 PR 信息、释放旧租约，
 * 守护进程会重新领回（本机还有会话记录时），必要时从分支或 PR 记录里重建工作树，再推送并创建 PR。
 */
export async function restoreTask(
  taskId: string,
): Promise<{ ok: boolean; error?: string }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (!canRestore(task.stage))
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，不能恢复`,
    };
  const db = await getDb();
  const s = await db
    .prepare(`SELECT id FROM sessions WHERE task_id=? LIMIT 1`)
    .bind(taskId)
    .first<{ id: string }>();
  if (!s)
    return {
      ok: false,
      error: "这个任务从没有开始过会话，没有可恢复的内容；请用“重新开始”",
    };
  await db
    .prepare(`UPDATE leases SET released=1 WHERE task_id=? AND released=0`)
    .bind(taskId)
    .run();
  await db
    .prepare(
      `UPDATE tasks SET stage='reviewing', head_sha=NULL, approved_sha=NULL, pr_number=NULL, pr_url=NULL, error=NULL, updated_at=? WHERE id=?`,
    )
    .bind(now(), taskId)
    .run();
  await notify(
    taskId,
    "restored",
    "已由人恢复到待审核，等待守护进程重新推送并创建 PR",
  );
  return { ok: true };
}

/**
 * 已发布的任务继续迭代：人在会话里写了新意见 → 任务回到“进行中”（第 N+1 轮），消息进收件箱，
 * 守护进程重新领回，在同一个会话里接着改（保留上下文）、新开分支提交与 PR，审核后再次发布。
 * 清掉上一轮的提交与 PR 信息（上一轮的 PR 已经合并）；旧租约释放，守护进程按“进行中且没有有效租约”领回。
 */
export async function iterateTask(
  taskId: string,
  text: string,
): Promise<{ ok: boolean; error?: string; round?: number }> {
  const task = await getTask(taskId);
  if (!task) return { ok: false, error: "任务不存在" };
  if (!canIterate(task.stage))
    return {
      ok: false,
      error: `当前阶段是 ${STAGE_LABEL[task.stage] ?? task.stage}，只有已发布的任务可以继续迭代`,
    };
  const db = await getDb();
  const s = await db
    .prepare(
      `SELECT id FROM sessions WHERE task_id=? ORDER BY created_at DESC LIMIT 1`,
    )
    .bind(taskId)
    .first<{ id: string }>();
  if (!s)
    return { ok: false, error: "这个任务没有会话，不能继续迭代；请新建任务" };
  const round = (task.round ?? 1) + 1;
  const advanced = await db
    .prepare(
      `WITH advanced AS (
      UPDATE tasks SET stage='running', round=?, plan_approved=0, head_sha=NULL, approved_sha=NULL,
        pr_number=NULL, pr_url=NULL, error=NULL, updated_at=? WHERE id=? AND stage='published' AND round=? RETURNING id,project_id,round
    ), message AS (
      INSERT INTO inbox(session_id,kind,body,created_at) SELECT ?,'message',?,? FROM advanced RETURNING id
    ), released AS (
      UPDATE leases SET released=1 WHERE task_id IN (SELECT id FROM advanced) AND released=0 RETURNING id
    ), plan AS (
      INSERT INTO task_plan_rounds(task_id,round,binding_id,wiki_url,updated_at)
      SELECT a.id,a.round,COALESCE(old.binding_id,b.id),COALESCE(old.wiki_url,b.wiki_url),?
      FROM advanced a JOIN projects p ON p.id=a.project_id
      LEFT JOIN task_plan_rounds old ON old.task_id=a.id AND old.round=a.round-1
      LEFT JOIN space_feishu_bindings b ON b.space_id=p.space_id AND b.enabled=1
      WHERE COALESCE(old.binding_id,b.id) IS NOT NULL ON CONFLICT(task_id,round) DO NOTHING RETURNING task_id
    ) SELECT round FROM advanced`,
    )
    .bind(round, now(), taskId, task.round ?? 1, s.id, text, now(), now())
    .first<{ round: number }>();
  if (!advanced) return { ok: false, error: "任务状态已经变化，请刷新后重试" };
  await notify(
    taskId,
    "iterate",
    `继续迭代（第 ${round} 轮）：${text.slice(0, 80)}`,
  );
  return { ok: true, round };
}
