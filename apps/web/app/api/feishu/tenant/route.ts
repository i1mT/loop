import { feishuAccess } from "@/lib/feishu/access.ts";
import { getBinding } from "@/lib/feishu/bindings.ts";
import { fail, json } from "@/lib/http.ts";

/**
 * 重置企业归属：清掉已记录的企业标识，让下一条已验证消息重新建立归属。
 * 用于应用曾安装在别的企业、或早期测试写入错误企业后所有消息都被拒绝的情况。
 */
export async function POST(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (!binding) return fail(400, "机器人尚未绑定");
  await gate.db
    .prepare(
      `UPDATE space_feishu_bindings SET tenant_key='',tenant_verified_at=NULL,tenant_mismatch_at=NULL,tenant_mismatch_key=NULL WHERE id=?`,
    )
    .bind(binding.id)
    .run();
  return json({ ok: true });
}
