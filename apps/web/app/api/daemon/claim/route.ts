import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { claim } from "@/lib/daemon-api.ts";
import { getDb } from "@/lib/db.ts";
import { pendingProbes } from "@/lib/machines.ts";

export async function POST(req: Request) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const body = await readJson<{
    daemonId?: string;
    holding?: string[];
    capabilities?: { technicalPlan?: boolean };
  }>(req);
  if (!body?.daemonId) return fail(400, "需要 daemonId");
  const r = await claim(
    body.daemonId,
    Array.isArray(body.holding)
      ? body.holding.filter((x) => typeof x === "string")
      : [],
    body.capabilities?.technicalPlan === true,
  );
  // 随领取响应带回：用户在页面点了“刷新模型列表”的智能体
  return json({
    ok: true,
    claim: r,
    probe: await pendingProbes(await getDb(), body.daemonId),
  });
}
