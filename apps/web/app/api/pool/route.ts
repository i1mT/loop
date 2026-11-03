import { getAllPools } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { json, requireRole } from "@/lib/http.ts";
import { requestSpace } from "@/lib/spaces.ts";

// 全部项目里“等待合并”的小反馈（全局任务页的“等待合并”标签）
export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  return json({ ok: true, pool: await getAllPools(await getDb(), requestSpace(req) ?? undefined) });
}
