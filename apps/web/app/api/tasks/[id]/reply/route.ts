import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { enqueueForTask, iterateTask, retryPublishTask } from "@/lib/daemon-api.ts";
import { canIterate, canReply } from "@/lib/status.ts";
import { getTask } from "@/lib/tasks.ts";

// 人类在网关里回复：写入该任务最近会话的收件箱，由守护进程取走
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ text?: string }>(req);
  if (!body?.text) return fail(400, "需要 text");
  const task = await getTask(id);
  if (!task) return fail(404, "任务不存在");
  // 已发布：这条消息就是新一轮的开始，同一个会话接着改（见 iterateTask）
  if (canIterate(task.stage)) {
    const it = await iterateTask(id, body.text);
    return it.ok ? json({ ok: true, round: it.round }, 202) : fail(409, it.error ?? "失败");
  }
  // 待确认发布：用户发来的要求就是“继续解决发布问题”，复用已合并的 PR 重跑发布。
  if (task.stage === "publish_review") {
    const r = await retryPublishTask(id, body.text);
    return r.ok ? json({ ok: true }, 202) : fail(409, r.error ?? "失败");
  }
  // 失败、驳回、取消的任务没有会话在管理，消息写进收件箱也没人取：明确拒绝，而不是悄悄丢掉
  if (!canReply(task.stage)) return fail(409, "任务已经结束，没有会话会收到这条消息。失败、驳回、取消的任务请用“恢复”或“重新开始”");
  const r = await enqueueForTask(id, { kind: "message", body: body.text });
  return r.ok ? json({ ok: true }, 202) : fail(409, r.error ?? "失败");
}
