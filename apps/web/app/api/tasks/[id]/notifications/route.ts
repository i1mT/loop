import { json, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";

// 通知记录（给提交者的消息，阶段 05 只记录，不接外部渠道）
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const db = await getDb();
  const rows = (await db.prepare(`SELECT id, kind, body, created_at AS "createdAt" FROM notifications WHERE task_id=? ORDER BY id ASC`).bind(id).all()).results;
  return json({ ok: true, notifications: rows });
}
