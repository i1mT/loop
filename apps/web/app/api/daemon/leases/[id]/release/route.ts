import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { releaseLease } from "@/lib/daemon-api.ts";

// 守护进程在驳回/取消后的收尾完成，释放租约
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string }>(req);
  if (!body?.daemonId) return fail(400, "需要 daemonId");
  const r = await releaseLease(id, body.daemonId);
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
