import { json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { listMachines } from "@/lib/machines.ts";
import { requestSpace } from "@/lib/spaces.ts";

// 机器列表：在线状态与各自的智能体
export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  return json({ ok: true, machines: await listMachines(await getDb(), requestSpace(req) ?? undefined) });
}
