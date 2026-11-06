import { retryPublishTask } from "@/lib/daemon-api.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";

// 重试发布（管理员）：PR 已经合并、只是发布失败时，复用原 PR 重跑发布，不新建分支或 PR。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ note?: string }>(req).catch(() => null);
  const r = await retryPublishTask((await params).id, body?.note);
  return r.ok ? json({ ok: true }) : fail(r.error === "任务不存在" ? 404 : 409, r.error ?? "失败");
}
