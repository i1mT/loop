import { getDb } from "@/lib/db.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import {
  acceptTechnicalPlan,
  getTechnicalPlan,
  acceptImplementationRecord,
} from "@/lib/task-plan/service.ts";

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{
    daemonId?: string;
    leaseId?: string;
    round?: number;
    markdown?: string;
    baselineHead?: string;
    kind?: "result";
  }>(req);
  if (
    !body?.daemonId ||
    !body.leaseId ||
    !Number.isInteger(body.round) ||
    typeof body.markdown !== "string"
  )
    return fail(400, "需要完整的方案与租约信息");
  const db = await getDb();
  try {
    if (body.kind === "result") {
      await acceptImplementationRecord(db, {
        taskId: id,
        round: body.round!,
        leaseId: body.leaseId,
        daemonId: body.daemonId,
        markdown: body.markdown,
      });
    } else {
      if (!body.baselineHead) return fail(400, "缺少工作树基线");
      await acceptTechnicalPlan(db, {
        taskId: id,
        round: body.round!,
        daemonId: body.daemonId,
        leaseId: body.leaseId,
        markdown: body.markdown,
        baselineHead: body.baselineHead,
      });
    }
    return json({ ok: true, plan: await getTechnicalPlan(db, id, body.round) });
  } catch (e) {
    return fail(409, (e as Error).message);
  }
}
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const url = new URL(req.url);
  const db = await getDb();
  const valid = await db
    .prepare(
      `SELECT t.id FROM tasks t JOIN leases l ON l.task_id=t.id WHERE t.id=? AND l.id=? AND l.daemon_id=? AND l.released=0 AND l.expires_at>? AND t.stage NOT IN ('cancelled','rejected','failed','published')`,
    )
    .bind(
      id,
      url.searchParams.get("leaseId"),
      url.searchParams.get("daemonId"),
      Date.now(),
    )
    .first();
  if (!valid) return fail(409, "租约已失效");
  return json({ ok: true, plan: await getTechnicalPlan(db, id) });
}
