import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { recordMerge } from "@/lib/daemon-api.ts";

// 发布检查点：PR 刚合并、开始执行发布前记录合并提交。发布随后崩溃也能知道代码已在主分支。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ daemonId?: string; mergeSha?: string }>(req);
  if (!body?.daemonId || !body.mergeSha) return fail(400, "需要 daemonId、mergeSha");
  const r = await recordMerge(id, body.daemonId, body.mergeSha);
  return r.ok ? json({ ok: true }) : fail(r.status, r.error ?? "失败");
}
