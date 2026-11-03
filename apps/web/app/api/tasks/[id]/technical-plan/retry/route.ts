import { getDb } from "@/lib/db.ts";
import { json, requireRole } from "@/lib/http.ts";
import { retryTechnicalPlan } from "@/lib/task-plan/service.ts";
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  await retryTechnicalPlan(await getDb(), id);
  return json({ ok: true });
}
