import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { decidePlan } from "@/lib/daemon-api.ts";

// 方案审核：批准（之后按方案实现）或驳回
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ decision?: "approve" | "reject"; reason?: string; revision?: number }>(req);
  if (body?.decision !== "approve" && body?.decision !== "reject") return fail(400, "decision 必须是 approve 或 reject");
  const r = await decidePlan(id, body.decision, body.reason ?? "", body.revision);
  return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
}
