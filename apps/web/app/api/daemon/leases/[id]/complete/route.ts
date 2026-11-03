import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { completePublish } from "@/lib/daemon-api.ts";

// 发布任务的结果回传
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; outcome?: "published" | "agent_done" | "failed" | "review_needed"; output?: string }>(req);
  if (!body?.daemonId || !body.outcome) return fail(400, "需要 daemonId、outcome");
  const r = await completePublish(id, body.daemonId, body.outcome, body.output ?? "");
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
