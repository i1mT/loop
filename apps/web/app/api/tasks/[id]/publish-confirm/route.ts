import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { confirmPublish } from "@/lib/daemon-api.ts";

// 人确认发布结果（管理员）：智能体发布结束后任务停在“待确认发布”，由人判定成功或失败。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ ok?: boolean; note?: string }>(req);
  if (typeof body?.ok !== "boolean") return fail(400, "需要 ok（布尔值）");
  const r = await confirmPublish(id, body.ok, body.note ?? "");
  return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
}
