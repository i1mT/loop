import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { heartbeat } from "@/lib/daemon-api.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string }>(req);
  if (!body?.daemonId) return fail(400, "需要 daemonId");
  const r = await heartbeat(id, body.daemonId);
  return r.ok ? json({ ok: true, expiresAt: r.expiresAt, stage: r.stage }) : fail(r.status, r.error);
}
