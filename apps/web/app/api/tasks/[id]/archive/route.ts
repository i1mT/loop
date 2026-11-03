import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { setTaskArchived } from "@/lib/tasks.ts";

// 归档/恢复任务（管理员）：只有已结束的任务可以归档。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ archived?: boolean }>(req);
  if (typeof body?.archived !== "boolean") return fail(400, "需要 archived（布尔值）");
  const r = await setTaskArchived((await params).id, body.archived);
  return r.ok ? json({ ok: true }) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
