import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { ingestEvents } from "@/lib/daemon-api.ts";

// 批量回传事件。幂等：同一 (session, seq) 重复提交只保留一份。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; leaseId?: string; events?: { seq: number; kind: string; payload: unknown; at: number }[] }>(req);
  if (!body?.daemonId || !body.leaseId || !Array.isArray(body.events)) return fail(400, "需要 daemonId、leaseId、events");
  if (body.events.length > 500) return fail(413, "一次最多 500 条");
  const r = await ingestEvents(id, body.leaseId, body.daemonId, body.events);
  return r.ok ? json({ ok: true, accepted: r.accepted, rejectedStageChanges: r.rejectedStageChanges }) : fail(r.status, r.error ?? "失败");
}
