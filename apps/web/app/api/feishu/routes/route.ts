import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding } from "@/lib/feishu/bindings.ts";
import { fail, json, readJson } from "@/lib/http.ts";
export async function PUT(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (!binding) return fail(400, "请先绑定机器人");
  const input = await readJson<{
    chatId: string;
    projectId: string;
    enabled: boolean;
  }>(req);
  if (!input || !/^oc_[A-Za-z0-9]+$/.test(input.chatId))
    return fail(400, "请填写正确的群 ID");
  const project = await gate.db
    .prepare(
      "SELECT id FROM projects WHERE id=? AND space_id=? AND archived_at IS NULL",
    )
    .bind(input.projectId, gate.spaceId)
    .first();
  if (!project) return fail(400, "项目不存在");
  await gate.db
    .prepare(
      "INSERT INTO feishu_chat_routes(binding_id,chat_id,project_id,enabled) VALUES(?,?,?,?) ON CONFLICT(binding_id,chat_id) DO UPDATE SET project_id=EXCLUDED.project_id,enabled=EXCLUDED.enabled",
    )
    .bind(binding.id, input.chatId, input.projectId, input.enabled ? 1 : 0)
    .run();
  return json({ ok: true });
}
export async function DELETE(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (binding)
    await gate.db
      .prepare(
        "DELETE FROM feishu_chat_routes WHERE binding_id=? AND chat_id=?",
      )
      .bind(binding.id, new URL(req.url).searchParams.get("chatId") ?? "")
      .run();
  return json({ ok: true });
}
