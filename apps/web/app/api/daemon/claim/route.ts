import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { RECOMMENDED_DAEMON_VERSION } from "@/lib/daemon-compatibility.ts";
import { claim } from "@/lib/daemon-api.ts";
import { getDb } from "@/lib/db.ts";
import { pendingProbes } from "@/lib/machines.ts";
import { configuredPublicOrigin } from "@/lib/public-url.ts";

export async function POST(req: Request) {
  const denied = await requireRole(req, "daemon");
  if (denied) return denied;
  const body = await readJson<{
    daemonId?: string;
    version?: string;
    holding?: string[];
    delivering?: string[];
    capabilities?: { technicalPlan?: boolean; delivery?: boolean; previewRepair?: boolean };
  }>(req);
  if (!body?.daemonId) return fail(400, "需要 daemonId");
  const r = await claim(
    body.daemonId,
    Array.isArray(body.holding)
      ? body.holding.filter((x) => typeof x === "string")
      : [],
    body.capabilities?.technicalPlan === true,
    body.capabilities?.delivery === true,
    Array.isArray(body.delivering) ? body.delivering.filter((x) => typeof x === "string") : [],
    body.version,
    body.capabilities?.previewRepair === true,
  );
  // 随领取响应带回：用户在页面点了“刷新模型列表”的智能体
  return json({
    ok: true,
    claim: r,
    publicUrl: configuredPublicOrigin(),
    recommendedVersion: RECOMMENDED_DAEMON_VERSION,
    probe: await pendingProbes(await getDb(), body.daemonId),
  });
}
