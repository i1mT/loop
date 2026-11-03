import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { setAgentConfig } from "@/lib/machines.ts";

// 配置某台机器上某个智能体的默认模型与思考程度（之后创建的任务使用）
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id, kind } = await params;
  const body = await readJson<{ model?: string | null; effort?: string | null }>(req);
  if (!body) return fail(400, "需要 JSON");
  const err = await setAgentConfig(await getDb(), id, kind, body);
  return err ? fail(400, err) : json({ ok: true });
}
