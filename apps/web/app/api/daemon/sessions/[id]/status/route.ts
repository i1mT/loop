import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { updateSessionState } from "@/lib/daemon-api.ts";
import type { SessionState } from "@/lib/session-stage.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; leaseId?: string; state?: SessionState }>(req);
  if (!body?.daemonId || !body.leaseId || !body.state) return fail(400, "需要 daemonId、leaseId、state");
  const r = await updateSessionState(id, body.state, body.leaseId, body.daemonId);
  return r.ok ? json({ ok: true, rejectedStageChanges: r.rejectedStageChanges }) : fail(r.status, r.error ?? "失败");
}
