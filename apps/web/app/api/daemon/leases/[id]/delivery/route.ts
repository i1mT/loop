import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { deliveryCandidates, reportDelivery, type DeliveryReport } from "@/lib/delivery.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<DeliveryReport | { daemonId: string; candidates: true }>(req);
  if (!body?.daemonId) return fail(400, "需要机器 ID");
  if ("candidates" in body) return json({ tasks: await deliveryCandidates(id, body.daemonId) });
  if (!body.state || !Number.isInteger(body.round)) return fail(400, "缺少交付轮次或进度");
  return await reportDelivery(id, body) ? json({ ok: true }) : fail(409, "任务阶段或租约已变化");
}
