import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { reportHead } from "@/lib/daemon-api.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; leaseId?: string; head?: string; branch?: string | null; prNumber?: number | null; prUrl?: string | null }>(req);
  if (!body?.daemonId || !body.leaseId || !body.head) return fail(400, "需要 daemonId、leaseId、head");
  const r = await reportHead(id, body.leaseId, body.daemonId, body.head, { branch: body.branch, prNumber: body.prNumber, prUrl: body.prUrl });
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
