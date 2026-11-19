import { fail, json, requireRole } from "@/lib/http.ts";
import { undeliveredInbox } from "@/lib/daemon-api.ts";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const { id } = await params;
  const search = new URL(req.url).searchParams;
  const after = Number(search.get("after") ?? 0);
  const requested = search.get("mode");
  const mode = requested === "publish" || requested === "work" ? requested : "legacy";
  return json({ ok: true, items: await undeliveredInbox(id, Number.isFinite(after) ? after : 0, mode) });
}
