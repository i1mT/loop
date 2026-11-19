import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { sendTaskReply } from "@/lib/task-conversation.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const body = await readJson<{ text?: unknown }>(req);
  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return fail(400, "请填写要发送的消息");
  const result = await sendTaskReply((await params).id, text);
  return result.ok ? json(result, 202) : fail(result.status, result.error);
}
