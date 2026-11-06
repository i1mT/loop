import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { requestSpace } from "@/lib/spaces.ts";
import { requestUserId } from "@/lib/machine-access/request.ts";
import { createPairing } from "@/lib/machine-access/credentials.ts";

export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = requestUserId(req);
  const spaceId = requestSpace(req);
  if (!userId || !spaceId || spaceId === "space_none") return fail(403, "请先登录并选择已加入的空间");
  const body = await readJson<{ name?: string }>(req);
  if (body?.name != null && typeof body.name !== "string") return fail(400, "请输入机器名称");
  const pairing = await createPairing(await getDb(), userId, spaceId, body?.name ?? "我的电脑");
  return json({ ok: true, ...pairing }, 201, { "cache-control": "no-store" });
}
