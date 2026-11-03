import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { createApiKey, listApiKeys } from "@/lib/integrations.ts";
import { getProject } from "@/lib/tasks.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  if (!(await getProject(id))) return fail(404, "项目不存在");
  return json({ ok: true, keys: await listApiKeys(await getDb(), id) });
}

// 创建 API 密钥：明文只在这次响应里出现，之后无法再查看
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  if (!(await getProject(id))) return fail(404, "项目不存在");
  const body = await readJson<{ name?: string }>(req);
  const k = await createApiKey(await getDb(), id, body?.name ?? "");
  return json({ ok: true, id: k.id, secret: k.secret }, 201);
}
