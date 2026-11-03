import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { requestProbe } from "@/lib/machines.ts";

// 请求某台机器重新探测某个智能体的可选模型与思考程度（用户在设置模型时点“刷新”）
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ agent?: string }>(req);
  if (!body?.agent) return fail(400, "需要 agent");
  const err = await requestProbe(await getDb(), (await params).id, body.agent);
  return err ? fail(400, err) : json({ ok: true });
}
