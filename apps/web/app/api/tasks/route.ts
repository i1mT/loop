import { requestUserId } from "@/lib/machine-access/request.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { submitFeedback } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { requestSpace } from "@/lib/spaces.ts";
import { listTasks } from "@/lib/tasks.ts";

export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const archived = new URL(req.url).searchParams.get("archived") === "1";
  return json({ ok: true, tasks: await listTasks(100, archived, requestSpace(req) ?? undefined, requestUserId(req)) });
}

// 创建任务（手动）：属性在这里一次定好。小反馈会先进“等待合并”池，此时 task 为 null
export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{
    projectId?: string;
    title?: string;
    body?: string;
    agent?: string;
    releaseReview?: boolean;
    planReview?: boolean;
    /** false = 单独处理，不参与小问题合并；默认参与 */
    mergeable?: boolean;
    previewSlot?: string | null;
    priority?: "low" | "normal" | "urgent";
  }>(req);
  if (!body?.projectId || !body.title) return fail(400, "需要 projectId 与 title");
  const spaceId = requestSpace(req);
  const owned = await (await getDb()).prepare(`SELECT id FROM projects WHERE id=? AND space_id=?`).bind(body.projectId, spaceId).first();
  if (!owned) return fail(404, "项目不存在");
  try {
    const r = await submitFeedback({ ...body, actorId: requestUserId(req), projectId: body.projectId, title: body.title });
    return json({ ok: true, task: r.task, feedbackId: r.feedback.id, pooled: r.pooled }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
