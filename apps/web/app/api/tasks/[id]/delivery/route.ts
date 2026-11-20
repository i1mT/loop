import type { ReleaseTask } from "@loop/core";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { deliveryAction } from "@/lib/delivery.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ action?: "merge" | "retry"; head?: string; number?: number; tasks?: ReleaseTask[] }>(req);
  if (body?.action !== "merge" && body?.action !== "retry") return fail(400, "请选择合并或重试");
  return await deliveryAction((await params).id, body.action, body.head, body.number, body.tasks)
    ? json({ ok: true }) : fail(409, "任务或待合并提交已变化，请刷新后重试");
}
