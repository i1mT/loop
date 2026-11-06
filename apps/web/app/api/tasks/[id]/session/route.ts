import { requestUserId } from "@/lib/machine-access/request.ts";
import { fail, json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { getProject, getTask } from "@/lib/tasks.ts";

// 会话视图的增量接口：返回最近会话 seq 之后的事件，以及尚未投递给守护进程的收件箱
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail(404, "任务不存在");
  const project = await getProject(task.project_id,requestUserId(req));
  const search = new URL(req.url).searchParams;
  const afterRaw = search.get("after");
  const beforeRaw = search.get("before");
  const after = afterRaw === null ? null : Number(afterRaw);
  const before = beforeRaw === null ? null : Number(beforeRaw);
  const limit = Math.min(Math.max(Number(search.get("limit") ?? 120) || 120, 1), 300);
  const db = await getDb();
  const session = await db
    .prepare(`SELECT id, agent, state, created_at, updated_at FROM sessions WHERE task_id=? ORDER BY created_at DESC LIMIT 1`)
    .bind(id)
    .first<{ id: string; agent: string; state: string; created_at: number; updated_at: number }>();
  const notifications = (await db.prepare(`SELECT id, kind, body, created_at AS "createdAt" FROM notifications WHERE task_id=? ORDER BY id DESC LIMIT 30`).bind(id).all()).results.reverse();
  const review = {
    releaseReview: !!task.release_review,
    planReview: !!task.plan_review && !task.plan_approved,
    headSha: task.head_sha,
    approvedSha: task.approved_sha,
    error: task.error,
  };
  if (!session) return json({ ok: true, task, project, stage: task.stage, session: null, events: [], pending: [], review, notifications, hasMore: false });
  // 增量轮询：只取游标之后的少量事件。
  // 首次进入或向上翻页：从最新（或 before 之前）倒序取一页，再按 seq 升序返回。
  let events: { seq: number; kind: string; payload: unknown; at: number }[];
  let hasMore = false;
  if (after !== null && Number.isFinite(after)) {
    events = (
      await db
        .prepare(`SELECT seq, kind, payload, at FROM session_events WHERE session_id=? AND seq>? ORDER BY seq ASC LIMIT 300`)
        .bind(session.id, after)
        .all<{ seq: number; kind: string; payload: string; at: number }>()
    ).results.map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
  } else {
    const rows = (
      await db
        .prepare(
          `SELECT seq, kind, payload, at FROM session_events WHERE session_id=?${before !== null && Number.isFinite(before) ? " AND seq<?" : ""} ORDER BY seq DESC LIMIT ?`,
        )
        .bind(session.id, ...(before !== null && Number.isFinite(before) ? [before, limit] : [limit]))
        .all<{ seq: number; kind: string; payload: string; at: number }>()
    ).results;
    hasMore = rows.length === limit;
    events = rows.reverse().map((e) => ({ ...e, payload: JSON.parse(e.payload) }));
    if (hasMore && events.length) {
      const oldest = events[0].seq;
      hasMore = !!(await db
        .prepare(`SELECT 1 FROM session_events WHERE session_id=? AND seq<? LIMIT 1`)
        .bind(session.id, oldest)
        .first());
    }
  }
  const pending = (
    await db
      .prepare(`SELECT id, kind, body, option_id AS "optionId", created_at AS "createdAt" FROM inbox WHERE session_id=? AND delivered_at IS NULL ORDER BY id ASC`)
      .bind(session.id)
      .all()
  ).results;
  return json({ ok: true, task, project, stage: task.stage, session, events, pending, review, notifications, hasMore });
}
