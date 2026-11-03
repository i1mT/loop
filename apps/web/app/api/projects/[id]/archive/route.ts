import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { setProjectArchived } from "@/lib/tasks.ts";

// 归档/恢复项目（管理员）：归档后不再接收新任务，已有任务不受影响。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ archived?: boolean }>(req);
  if (typeof body?.archived !== "boolean") return fail(400, "需要 archived（布尔值）");
  const r = await setProjectArchived((await params).id, body.archived);
  return r.ok ? json({ ok: true }) : fail(404, r.error ?? "失败");
}
