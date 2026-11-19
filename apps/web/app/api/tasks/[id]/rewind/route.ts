import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { rewindTask } from "@/lib/task-conversation.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ target?: unknown }>(req);
  if (body?.target !== "reviewing" && body?.target !== "development") return fail(400, "请选择要回退的阶段");
  const result = await rewindTask((await params).id, body.target);
  return result.ok ? json(result) : fail(result.status, result.error);
}
