import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { markTaskNeedsYou } from "@/lib/daemon-api.ts";

// 守护进程发现本轮没有产生提交：任务停在“需要你”，等人回复后继续，而不是进入没有 PR 的待审核。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; leaseId?: string; reason?: string }>(req);
  if (!body?.daemonId || !body.leaseId || !body.reason) return fail(400, "需要 daemonId、leaseId、reason");
  const r = await markTaskNeedsYou(id, body.leaseId, body.daemonId, body.reason);
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
