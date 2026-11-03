import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { REPORTER_LABEL, getSourceByKey, statusToken } from "@/lib/integrations.ts";
import { corsHeaders, originAllowed } from "@/lib/origins.ts";
import { feedbackProgress } from "@/lib/batch.ts";

// 提交者在 SDK 里查看自己反馈的进度：POST ?key=<SDK 公钥>，{items:[{id, t}]}，t 是提交时返回的令牌
export async function OPTIONS(req: Request) {
  const source = await getSourceByKey(await getDb(), new URL(req.url).searchParams.get("key") ?? "");
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin"), source) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("Origin");
  const db = await getDb();
  const source = await getSourceByKey(db, new URL(req.url).searchParams.get("key") ?? "");
  const h = corsHeaders(origin, source);
  if (!source) return Response.json({ ok: false, error: "接入不存在" }, { status: 404, headers: h });
  if (origin ? !originAllowed(origin, source.allowed_origins) : !!source.allowed_origins) return Response.json({ ok: false, error: "该站点未被允许" }, { status: 403, headers: h });
  const body = (await req.json().catch(() => null)) as { items?: { id?: string; t?: string }[] } | null;
  const secret = getEnv().BETTER_AUTH_SECRET;
  const out = [];
  for (const it of (body?.items ?? []).slice(0, 10)) {
    if (!it.id || !it.t || it.t !== (await statusToken(secret, it.id))) continue; // 令牌不对：当作不存在
    // 按反馈查：池中显示“已收到”，已并入任务的读那个任务的阶段（多条反馈合成一个任务时，同一个任务的进度）
    const p = await feedbackProgress(db, it.id);
    if (!p || p.feedback.project_id !== source.project_id || p.feedback.source !== "sdk" || !p.stage) continue;
    out.push({
      id: p.feedback.id,
      title: p.feedback.title.replace(/^\[反馈\]\s*/, ""),
      stage: p.stage,
      label: REPORTER_LABEL[p.stage] ?? "处理中",
      updated_at: p.updatedAt,
      message: p.stage === "published" ? "已修复并上线，感谢你的反馈。" : null,
    });
  }
  return Response.json({ ok: true, items: out }, { headers: h });
}
