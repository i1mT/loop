import { restoreTask } from "@/lib/daemon-api.ts";
import { fail, json, requireRole } from "@/lib/http.ts";

// 恢复（管理员）：把取消/驳回/失败的任务改回“待审核”，由守护进程重建工作树并重新推送、创建 PR。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await restoreTask((await params).id);
  return r.ok ? json({ ok: true }) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
