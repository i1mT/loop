import { projectManageSql } from "@/lib/routing/access.ts";
import { feishuAccess } from "@/lib/feishu/access.ts";
import {
  bindingView,
  getBinding,
  saveBinding,
  type BindingInput,
} from "@/lib/feishu/bindings.ts";
import { json, fail, readJson } from "@/lib/http.ts";
import { getEnv } from "@/lib/env.ts";
export async function GET(req: Request) {
  const gate = await feishuAccess(req);
  if (gate instanceof Response) return gate;
  const { db, spaceId, userId, canManage } = gate;
  const binding = await getBinding(db, spaceId);
  const projects = (
    await db
      .prepare(
        `SELECT p.id,p.name FROM projects p WHERE p.space_id=? AND p.archived_at IS NULL AND ${projectManageSql("p")} ORDER BY p.name`,
      )
      .bind(spaceId,userId)
      .all()
  ).results;
  const routes = binding
    ? (
        await db
          .prepare(
            'SELECT chat_id AS "chatId",chat_name AS "chatName",project_id AS "projectId",enabled FROM feishu_chat_routes WHERE binding_id=?',
          )
          .bind(binding.id)
          .all()
      ).results
    : [];
  const identities =
    binding && canManage
      ? (
          await db
            .prepare(
              'SELECT i.open_id AS "openId",i.user_id AS "userId",u.name FROM feishu_identities i JOIN "user" u ON u.id=i.user_id WHERE binding_id=?',
            )
            .bind(binding.id)
            .all()
        ).results
      : [];
  const jobs =
    binding && canManage
      ? (
          await db
            .prepare(
              `SELECT id,kind,state,error,attempts,created_at AS "createdAt" FROM feishu_jobs WHERE binding_id=? AND state<>'done' ORDER BY created_at DESC LIMIT 30`,
            )
            .bind(binding.id)
            .all()
        ).results
      : [];
  const linked = binding
    ? !!(await db
        .prepare(
          "SELECT open_id FROM feishu_identities WHERE binding_id=? AND user_id=?",
        )
        .bind(binding.id, userId)
        .first())
    : false;
  return json({
    ok: true,
    binding: binding ? bindingView(binding, new URL(req.url).origin) : null,
    routes,
    identities,
    jobs,
    projects,
    canManage,
    linked,
  });
}
export async function PUT(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const input = await readJson<BindingInput>(req);
  if (!input) return fail(400, "配置内容无效");
  try {
    const binding = await saveBinding(
      gate.db,
      gate.spaceId,
      input,
      getEnv().FEISHU_ENCRYPTION_KEY ?? "",
    );
    return json({
      ok: true,
      binding: bindingView(binding, new URL(req.url).origin),
    });
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "保存失败");
  }
}
