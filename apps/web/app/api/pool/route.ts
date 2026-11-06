import { requestUserId } from "@/lib/machine-access/request.ts";
import { listProjects } from "@/lib/tasks.ts";
import { getAllPools } from "@/lib/batch.ts";
import { getDb } from "@/lib/db.ts";
import { json, requireRole } from "@/lib/http.ts";
import { requestSpace } from "@/lib/spaces.ts";

// 全部项目里“等待合并”的小反馈（全局任务页的“等待合并”标签）
export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const spaceId = requestSpace(req) ?? undefined;
  const allowed = new Set((await listProjects(false, spaceId, requestUserId(req))).map(project => project.id));
  const pool = await getAllPools(await getDb(), spaceId);
  return json({ ok: true, pool: { ...pool, items: pool.items.filter(item => allowed.has(item.project_id)) } });
}
