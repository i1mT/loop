import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { hello, validMachineId, type HelloBody } from "@/lib/machines.ts";

// 守护进程以机器身份注册并上报智能体（同时刷新在线状态）
export async function POST(req: Request) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const body = await readJson<HelloBody>(req);
  if (!body || !validMachineId(body.machineId)) return fail(400, "需要合法的 machineId（小写字母、数字、- _ .，最长 64）");
  if (!Array.isArray(body.agents)) return fail(400, "需要 agents");
  await hello(await getDb(), body);
  return json({ ok: true });
}
