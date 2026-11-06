import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding, getBindingSecrets } from "@/lib/feishu/bindings.ts";
import { FeishuClient } from "@/lib/feishu/client.ts";
import { getEnv } from "@/lib/env.ts";
import { fail, json, readJson } from "@/lib/http.ts";

// 首次配置时只需要应用凭证即可选择群聊，不要求先保存完整绑定。
export async function POST(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const body = await readJson<{
    appId?: string;
    appSecret?: string;
    pageToken?: string;
  }>(req);
  if (
    !body ||
    (body.appId !== undefined && typeof body.appId !== "string") ||
    (body.appSecret !== undefined && typeof body.appSecret !== "string") ||
    (body.pageToken !== undefined &&
      (typeof body.pageToken !== "string" || body.pageToken.length > 2048))
  )
    return fail(400, "群聊列表请求无效");
  const binding = await getBinding(gate.db, gate.spaceId);
  const appId = body.appId?.trim() || binding?.app_id || "";
  if (!/^cli_[A-Za-z0-9]+$/.test(appId))
    return fail(400, "请先填写企业自建应用的 App ID");
  if (binding && appId !== binding.app_id)
    return fail(400, "请使用当前绑定的企业自建应用");
  try {
    const saved = binding
      ? await getBindingSecrets(
          gate.db,
          binding.id,
          getEnv().FEISHU_ENCRYPTION_KEY ?? "",
        )
      : null;
    const appSecret = body.appSecret?.trim() || saved?.appSecret;
    if (!appSecret)
      return fail(400, "请先填写 App Secret，再读取机器人加入的群聊");
    const client = new FeishuClient({
      appId,
      appSecret,
      verificationToken: "",
      encryptKey: "",
    });
    return json({ ok: true, ...(await client.listChats(body.pageToken)) });
  } catch {
    return fail(
      400,
      "无法读取群聊。请确认应用凭证有效，并在飞书「权限管理」中开通「查看群信息」（im:chat:read），在「版本管理与发布」发布企业内可用版本后重试。",
    );
  }
}
