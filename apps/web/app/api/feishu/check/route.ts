import { feishuAccess } from "@/lib/feishu/access.ts";
import {
  getBinding,
  getBindingSecrets,
  wikiToken,
} from "@/lib/feishu/bindings.ts";
import { FeishuClient } from "@/lib/feishu/client.ts";
import { getEnv } from "@/lib/env.ts";
import { fail, json } from "@/lib/http.ts";
export async function POST(req: Request) {
  const gate = await feishuAccess(req, true);
  if (gate instanceof Response) return gate;
  const binding = await getBinding(gate.db, gate.spaceId);
  if (!binding) return fail(400, "请先保存机器人配置");
  try {
    const client = new FeishuClient(
      await getBindingSecrets(
        gate.db,
        binding.id,
        getEnv().FEISHU_ENCRYPTION_KEY ?? "",
      ),
    );
    const node = await client.checkConnection(wikiToken(binding.wiki_url));
    return json({
      ok: true,
      message: `已经连接，可以读取目录“${node.title}”（${node.children} 个子文档）。创建文档需要应用具备 wiki:wiki 权限并加入知识库成员，会在首次同步时检查。`,
    });
  } catch (e) {
    return fail(400, e instanceof Error ? e.message : "连接失败");
  }
}
