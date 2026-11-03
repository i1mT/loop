import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { listTaskFeedbacks } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { getTask, updateTask } from "@/lib/tasks.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const task = await getTask(id);
  if (!task) return fail(404, "任务不存在");
  const db = await getDb();
  const sessions = (await db.prepare(`SELECT id, agent, state, created_at, updated_at FROM sessions WHERE task_id=? ORDER BY created_at DESC`).bind(id).all()).results;
  // 最近会话的事件（阶段 04 会换成正式的会话界面）
  const latest = (sessions[0] as { id: string } | undefined)?.id;
  const events = latest
    ? (await db.prepare(`SELECT seq, kind, payload, at FROM session_events WHERE session_id=? ORDER BY seq ASC LIMIT 500`).bind(latest).all<{ seq: number; kind: string; payload: string; at: number }>()).results.map((e) => ({ ...e, payload: JSON.parse(e.payload) }))
    : [];
  return json({ ok: true, task, feedbacks: await listTaskFeedbacks(db, id), sessions, events });
}

// 修改标题与正文（管理员）。正文只在任务还没开始时可改。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ title?: string; body?: string }>(req);
  if (!body || (body.title === undefined && body.body === undefined)) return fail(400, "需要 title 或 body");
  const r = await updateTask((await params).id, body);
  return r.ok ? json({ ok: true }) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
