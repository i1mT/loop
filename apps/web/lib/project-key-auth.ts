import { getDb } from "./db.ts";
import { authenticateApiKey } from "./integrations.ts";

/** 从 Authorization: Bearer lp_… 取项目 API 密钥并换出项目；不合法返回 null */
export async function projectFromApiKey(req: Request): Promise<{ projectId: string; keyId: string } | null> {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ")) return null;
  return authenticateApiKey(await getDb(), h.slice(7).trim());
}
