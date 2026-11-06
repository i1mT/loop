import { requestSpace } from "@/lib/spaces.ts";
import { fail, json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { requestUserId } from "@/lib/machine-access/request.ts";
import { createPairing, revokeMachineCredential } from "@/lib/machine-access/credentials.ts";

/** 重新连接复用机器 ID 与会话目录；仅在兑换时废止旧凭证。 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = requestUserId(req);
  const spaceId = requestSpace(req);
  if (!userId || !spaceId || spaceId === "space_none") return fail(403, "请先选择空间");
  const machineId = (await params).id;
  const machine = await (await getDb()).prepare(`SELECT name FROM machines WHERE id=? AND owner_user_id=?`).bind(machineId,userId).first<{name:string}>();
  if (!machine) return fail(403, "只有所有者可以重新连接机器");
  return json({ ok:true, ...await createPairing(await getDb(),userId,spaceId,machine.name,machineId) }, 200, { "cache-control":"no-store" });
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId=requestUserId(req);
  if (!userId) return fail(403,"请先登录");
  await revokeMachineCredential(await getDb(),(await params).id,userId);
  return json({ ok: true });
}
