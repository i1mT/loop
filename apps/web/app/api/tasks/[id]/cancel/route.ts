import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { cancelTask } from "@/lib/daemon-api.ts";

// 取消任务（管理员）。已有会话的由守护进程在下一次心跳时关闭 PR、清理 worktree。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ reason?: string }>(req);
  const r = await cancelTask(id, body?.reason ?? "");
  return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
}
