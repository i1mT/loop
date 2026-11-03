import { getDb } from "@/lib/db.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import {
  getTechnicalPlan,
  planHistory,
  reviseTechnicalPlan,
} from "@/lib/task-plan/service.ts";
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const db = await getDb();
  return json({
    ok: true,
    plan: await getTechnicalPlan(db, id),
    history: await planHistory(db, id),
    records: (
      await db
        .prepare(
          `SELECT round,kind,sync_error AS "syncError",content_hash=synced_hash AS synced FROM task_plan_records WHERE task_id=? ORDER BY round DESC`,
        )
        .bind(id)
        .all()
    ).results,
  });
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ revision?: number; markdown?: string }>(req);
  if (!Number.isInteger(body?.revision) || typeof body?.markdown !== "string")
    return fail(400, "需要方案版本与完整内容");
  try {
    await reviseTechnicalPlan(
      await getDb(),
      id,
      body!.revision!,
      body!.markdown!,
    );
    return json({ ok: true });
  } catch (e) {
    return fail(409, (e as Error).message);
  }
}
