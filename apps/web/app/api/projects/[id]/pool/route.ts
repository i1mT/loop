import { getPool } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { json, requireRole } from "@/lib/http.ts";

// 项目的“等待合并”池：还没有任务的小反馈
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  return json({ ok: true, pool: await getPool(await getDb(), (await params).id) });
}
