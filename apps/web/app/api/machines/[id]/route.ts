import { requestUserId } from "@/lib/machine-access/request.ts";
import { setMachineSharing } from "@/lib/machine-access/policy.ts";
import { requestSpace } from "@/lib/spaces.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { deleteMachine } from "@/lib/machines.ts";

// 删除机器的登记（管理员）：只能删离线、没有项目绑定、没有未结束任务的机器。
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const r = await deleteMachine(await getDb(), (await params).id);
  return r.ok ? json({ ok: true }) : fail(r.error === "机器不存在" ? 404 : 409, r.error ?? "失败");
}

// 仅所有者可以修改当前空间的共享授权。
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ shared?: boolean }>(req);
  if (typeof body?.shared !== "boolean") return fail(400, "请选择是否共享");
  const userId = requestUserId(req);
  const spaceId = requestSpace(req);
  if (!userId || !spaceId || spaceId === "space_none") return fail(403, "请先选择空间");
  const error = await setMachineSharing(await getDb(), (await params).id, userId, spaceId, body.shared);
  return error ? fail(409, error) : json({ ok: true });
}
