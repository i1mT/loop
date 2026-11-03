import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding } from "@/lib/feishu/bindings.ts";
import { digest } from "@/lib/feishu/crypto.ts";
import { fail, json } from "@/lib/http.ts";
export async function POST(req: Request) {
  const gate = await feishuAccess(req);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (!binding?.enabled) return fail(400, "请先启用空间的飞书机器人");
  const code = crypto.randomUUID(),
    expiresAt = Date.now() + 10 * 60000;
  await gate.db
    .prepare(
      "INSERT INTO feishu_link_codes(code_hash,binding_id,user_id,expires_at) VALUES(?,?,?,?)",
    )
    .bind(await digest(code), binding.id, gate.userId, expiresAt)
    .run();
  return json({ ok: true, code, expiresAt });
}
