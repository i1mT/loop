import { republishTask } from "@/lib/daemon-api.ts";
import { fail, json, requireRole } from "@/lib/http.ts";

// 重新推送并创建 PR（管理员）：待审核却还没有 PR 时，让守护进程立刻重试。PR 由守护进程创建，不是智能体。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await republishTask((await params).id);
  return r.ok ? json({ ok: true }) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
