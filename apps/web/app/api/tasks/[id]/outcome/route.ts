import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { overrideOutcome } from "@/lib/daemon-api.ts";

// 人工改写任务结果（管理员）：发布环节或失败态的任务，可手动标记为已发布/失败。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ to?: "published" | "failed"; note?: string }>(req);
  if (body?.to !== "published" && body?.to !== "failed") return fail(400, "to 必须是 published 或 failed");
  const r = await overrideOutcome(id, body.to, body.note ?? "");
  return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
}
