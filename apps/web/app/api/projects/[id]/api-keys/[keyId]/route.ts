import { fail, json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { revokeApiKey } from "@/lib/integrations.ts";

// 撤销 API 密钥：立即失效，不可恢复
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string; keyId: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id, keyId } = await params;
  return (await revokeApiKey(await getDb(), id, keyId)) ? json({ ok: true }) : fail(404, "密钥不存在或已撤销");
}
