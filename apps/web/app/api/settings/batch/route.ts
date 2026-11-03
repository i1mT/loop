import { getBatchSettings, saveBatchSettings, validateBatchSettings, type BatchSettings } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { requestSpace } from "@/lib/spaces.ts";

// 小问题合并的全局设置（管理员）。密钥本身是部署时的 Worker 密钥，这里只告诉页面“配了没有”。
export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  return json({ ok: true, settings: await getBatchSettings(await getDb(), requestSpace(req) ?? undefined), keyConfigured: !!getEnv().TYPESAFE_API_KEY });
}

export async function PUT(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<Partial<BatchSettings>>(req);
  const err = body ? validateBatchSettings(body) : "请求体不是 JSON";
  if (err) return fail(400, err);
  const settings: BatchSettings = { enabled: body!.enabled!, maxScale: body!.maxScale!, size: body!.size! };
  await saveBatchSettings(await getDb(), settings, requestSpace(req) ?? undefined);
  return json({ ok: true, settings });
}
