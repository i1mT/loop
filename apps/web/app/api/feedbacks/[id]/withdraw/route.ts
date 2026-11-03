import { withdrawFeedback } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { fail, json, requireRole } from "@/lib/http.ts";

// 撤回池里等待合并的反馈（已并入任务的要在任务上操作）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await withdrawFeedback(await getDb(), (await params).id);
  return r.ok ? json({ ok: true }) : fail(r.error === "反馈不存在" ? 404 : 409, r.error ?? "失败");
}
