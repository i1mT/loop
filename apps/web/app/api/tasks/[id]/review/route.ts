import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { approveTask, rejectTask } from "@/lib/daemon-api.ts";

// 发布审核：批准（记下当前提交）或驳回。只有待审核阶段可以操作。
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ decision?: "approve" | "reject"; reason?: string }>(req);
  if (body?.decision === "approve") {
    const r = await approveTask(id, "admin", body.reason ?? "");
    return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
  }
  if (body?.decision === "reject") {
    const r = await rejectTask(id, body.reason ?? "");
    return r.ok ? json({ ok: true }) : fail(409, r.error ?? "失败");
  }
  return fail(400, "decision 必须是 approve 或 reject");
}
