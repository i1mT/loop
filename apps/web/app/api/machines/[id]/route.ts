import { fail, json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { deleteMachine } from "@/lib/machines.ts";

// 删除机器的登记（管理员）：只能删离线、没有项目绑定、没有未结束任务的机器。
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await deleteMachine(await getDb(), (await params).id);
  return r.ok ? json({ ok: true }) : fail(r.error === "机器不存在" ? 404 : 409, r.error ?? "失败");
}
