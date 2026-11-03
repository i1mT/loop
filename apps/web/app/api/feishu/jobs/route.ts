import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding } from "@/lib/feishu/bindings.ts";
import { fail, json, readJson } from "@/lib/http.ts";
export async function POST(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (!binding) return fail(400, "请先绑定机器人");
  const body = await readJson<{ id?: string }>(req);
  await gate.db
    .prepare(
      `UPDATE feishu_jobs SET state='pending',attempts=0,next_at=?,locked_until=0,error=NULL WHERE binding_id=? AND state='failed'${body?.id ? " AND id=?" : ""}`,
    )
    .bind(Date.now(), binding.id, ...(body?.id ? [body.id] : []))
    .run();
  return json({ ok: true });
}
