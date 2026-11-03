import { fail, json, readJson } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { rateLimited } from "@/lib/integrations.ts";
import { projectFromApiKey } from "@/lib/project-key-auth.ts";
import { submitFeedback } from "@/lib/batch.ts";

// API 接入：用项目 API 密钥把任务直接推送进来。POST /api/v1/tasks
// 请求头 Authorization: Bearer lp_…；请求体 JSON：{title, body?, priority?, planReview?, releaseReview?, agent?, externalRef?}
export async function POST(req: Request) {
  const auth = await projectFromApiKey(req);
  if (!auth) return fail(401, "API 密钥无效或已撤销");
  const limited = await rateLimited(await getDb(), auth.projectId, "api");
  if (limited) return fail(429, limited);
  const body = await readJson<{ title?: string; body?: string; priority?: string; planReview?: boolean; releaseReview?: boolean; agent?: string; externalRef?: unknown }>(req);
  const title = body?.title?.toString().trim();
  if (!title) return fail(400, "缺少 title");
  if (body!.priority && !["low", "normal", "urgent"].includes(body!.priority)) return fail(400, "priority 只能是 low、normal、urgent");
  try {
    const r = await submitFeedback({
      projectId: auth.projectId,
      title: title.slice(0, 200),
      body: String(body!.body ?? "").slice(0, 20000),
      priority: (body!.priority as "low" | "normal" | "urgent" | undefined) ?? "normal",
      planReview: !!body!.planReview,
      releaseReview: body!.releaseReview !== false,
      agent: body!.agent,
      source: "api",
      sourceRef: { keyId: auth.keyId, externalRef: body!.externalRef ?? null },
    });
    // 小反馈可能先进“等待合并”池：此时 task 为 null，凑够后会合成一个任务；feedbackId 始终有值
    const t = r.task;
    return json({ ok: true, feedbackId: r.feedback.id, pooled: r.pooled, task: t ? { id: t.id, stage: t.stage, url: `${new URL(req.url).origin}/tasks/${t.id}` } : null }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}
