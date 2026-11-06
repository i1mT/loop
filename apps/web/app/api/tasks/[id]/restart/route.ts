import { requestUserId } from "@/lib/machine-access/request.ts";
import { fail, json, requireRole } from "@/lib/http.ts";
import { restartTask } from "@/lib/tasks.ts";

// 重新开始（管理员）：用失败/驳回/取消任务的内容新建一个任务，返回新任务。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await restartTask((await params).id,requestUserId(req));
  return r.ok ? json({ ok: true, task: r.task }, 201) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
