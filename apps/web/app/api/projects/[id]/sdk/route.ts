import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { ensureSdkSource, rotateSdkSecret, updateSdkSource } from "@/lib/integrations.ts";
import { getProject } from "@/lib/tasks.ts";

const view = (s: Awaited<ReturnType<typeof ensureSdkSource>>) => ({ key: s.key, allowedOrigins: s.allowed_origins ?? "", enabled: !!s.enabled, identitySecret: s.identity_secret });

// 项目的 SDK 接入设置：公钥、允许的站点、身份密钥（第一次访问时自动创建）
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  if (!(await getProject(id))) return fail(404, "项目不存在");
  return json({ ok: true, sdk: view(await ensureSdkSource(await getDb(), id)) });
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  if (!(await getProject(id))) return fail(404, "项目不存在");
  const body = await readJson<{ allowedOrigins?: string | null; enabled?: boolean }>(req);
  if (!body) return fail(400, "需要 JSON");
  const db = await getDb();
  const err = await updateSdkSource(db, id, { ...("allowedOrigins" in body ? { allowedOrigins: body.allowedOrigins } : {}), ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}) });
  if (err) return fail(400, err);
  return json({ ok: true, sdk: view(await ensureSdkSource(db, id)) });
}

// 重新生成公钥或身份密钥：旧值立即失效
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  if (!(await getProject(id))) return fail(404, "项目不存在");
  const body = await readJson<{ rotate?: "key" | "identity" }>(req);
  if (body?.rotate !== "key" && body?.rotate !== "identity") return fail(400, "rotate 只能是 key 或 identity");
  const db = await getDb();
  await rotateSdkSecret(db, id, body.rotate);
  return json({ ok: true, sdk: view(await ensureSdkSource(db, id)) });
}
