import { json, requireRole } from "@/lib/http.ts";
import { ackInbox } from "@/lib/daemon-api.ts";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  await ackInbox(Number(id));
  return json({ ok: true });
}
