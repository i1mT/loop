import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { failLease } from "@/lib/daemon-api.ts";

// 守护进程领取后无法启动：释放租约，任务标记为失败（不再被重派）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; reason?: string }>(req);
  if (!body?.daemonId) return fail(400, "需要 daemonId");
  const r = await failLease(id, body.daemonId, body.reason ?? "未知原因");
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
