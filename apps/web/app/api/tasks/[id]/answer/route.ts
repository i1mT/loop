import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { enqueueForTask } from "@/lib/daemon-api.ts";

// 人类回答 needs_you：选择一个选项（权限请求的 optionId，或规则类请求的选项 id）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ requestId?: string; optionId?: string }>(req);
  if (!body?.optionId) return fail(400, "需要 optionId");
  const r = await enqueueForTask(id, { kind: "decision", requestId: body.requestId, optionId: body.optionId });
  return r.ok ? json({ ok: true }, 202) : fail(409, r.error ?? "失败");
}
