import { fail, json, readJson } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { redeemPairing } from "@/lib/machine-access/credentials.ts";

// 连接码具有 256 位随机性，10 分钟有效且仅能使用一次；无需浏览器会话。
export async function POST(req: Request) {
  const body = await readJson<{ code?: string }>(req);
  if (typeof body?.code !== "string") return fail(400, "需要连接码");
  const result = await redeemPairing(await getDb(), body.code);
  return result ? json({ ok: true, ...result }, 201, { "cache-control": "no-store" }) : fail(410, "连接码已失效，请在机器页面重新生成");
}
