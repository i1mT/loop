import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding, getBindingSecrets } from "@/lib/feishu/bindings.ts";
import { getEnv } from "@/lib/env.ts";
import { fail, json } from "@/lib/http.ts";

// 单独读取，不进入设置列表和轮询缓存；只允许当前空间的管理者。
export async function POST(req: Request) {
  const access = await feishuAccess(req, true);
  if (access instanceof Response) return access;
  const binding = await getBinding(access.db, access.spaceId);
  if (!binding) return fail(404, "请先绑定飞书机器人");
  const credentials = await getBindingSecrets(
    access.db,
    binding.id,
    getEnv().FEISHU_ENCRYPTION_KEY ?? "",
  );
  return json(
    {
      ok: true,
      credentials: {
        appSecret: credentials.appSecret,
        verificationToken: credentials.verificationToken,
        encryptKey: credentials.encryptKey,
      },
    },
    200,
    { "cache-control": "no-store, private", pragma: "no-cache" },
  );
}
