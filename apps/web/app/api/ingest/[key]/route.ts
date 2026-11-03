import { getDb } from "@/lib/db.ts";
import { getEnv } from "@/lib/env.ts";
import { composeTaskBody, reportTitle, sanitizeReport, type SdkReport, type UploadedRef } from "@/lib/feedback.ts";
import { verifyIdentity } from "@/lib/identity.ts";
import { getSourceByKey, rateLimited, statusToken } from "@/lib/integrations.ts";
import { corsHeaders, originAllowed } from "@/lib/origins.ts";
import { submitFeedback } from "@/lib/batch.ts";
import { getProject } from "@/lib/tasks.ts";

const MAX_BODY = 14 * 1024 * 1024; // base64 内嵌图片，约等于 6 张 ≤ 1.7MB 的图
const MAX_FILES = 6;
const MAX_FILE = 5 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

const json = (data: unknown, status: number, headers: Record<string, string>) => Response.json(data, { status, headers });

export async function OPTIONS(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const source = await getSourceByKey(await getDb(), (await ctx.params).key);
  return new Response(null, { status: 204, headers: corsHeaders(req.headers.get("Origin"), source) });
}

// SDK 入口：POST /api/ingest/<SDK 公钥>，公开接口。
// 只接受 JSON：{report, files:[{name,kind,type,data(base64)}], identity?}。
// 不能用 multipart：vinext 会把它当作 Server Action 并对跨域请求做 CSRF 拦截。
export async function POST(req: Request, ctx: { params: Promise<{ key: string }> }) {
  const db = await getDb();
  const origin = req.headers.get("Origin");
  const source = await getSourceByKey(db, (await ctx.params).key);
  const h = corsHeaders(origin, source);
  if (!source) return json({ ok: false, error: "接入不存在或已停用" }, 404, h);
  if (origin ? !originAllowed(origin, source.allowed_origins) : !!source.allowed_origins) return json({ ok: false, error: "该站点未被允许" }, 403, h);
  const project = await getProject(source.project_id);
  if (!project) return json({ ok: false, error: "项目不存在" }, 404, h);
  if (Number(req.headers.get("content-length") ?? 0) > MAX_BODY) return json({ ok: false, error: "内容过大" }, 413, h);
  const limited = await rateLimited(db, project.id, "sdk");
  if (limited) return json({ ok: false, error: limited }, 429, h);

  let body: { report?: SdkReport; files?: { name?: string; kind?: string; type?: string; data?: string }[]; identity?: string };
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400, h);
  }
  if (!body.report || typeof body.report !== "object") return json({ ok: false, error: "缺少 report" }, 400, h);
  const report = sanitizeReport(body.report);

  const files: { bytes: Uint8Array<ArrayBuffer>; type: string; name: string; kind: string }[] = [];
  for (const f of (Array.isArray(body.files) ? body.files : []).slice(0, MAX_FILES)) {
    if (!f.type || !IMAGE_EXT[f.type] || typeof f.data !== "string") return json({ ok: false, error: "图片格式不符合要求" }, 400, h);
    let bytes: Uint8Array<ArrayBuffer>;
    try {
      bytes = Uint8Array.from(atob(f.data), (c) => c.charCodeAt(0));
    } catch {
      return json({ ok: false, error: "图片数据损坏" }, 400, h);
    }
    if (bytes.byteLength > MAX_FILE) return json({ ok: false, error: "图片过大" }, 413, h);
    files.push({ bytes, type: f.type, name: String(f.name ?? "image").slice(0, 80), kind: String(f.kind ?? "upload") });
  }
  if (!report.description?.trim() && !files.length && !report.element) return json({ ok: false, error: "反馈内容为空" }, 400, h);

  // 图片先存进 R2（对象名不可猜，作为能力链接给智能体和后台查看）。失败直接让 SDK 重试，不产生半成品任务
  const base = new URL(req.url).origin;
  const uploaded: UploadedRef[] = [];
  try {
    for (const f of files) {
      const file = `img_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${IMAGE_EXT[f.type]}`;
      await getEnv().FILES.put(file, f.bytes, { httpMetadata: { contentType: f.type } });
      uploaded.push({ id: file, name: f.name, kind: f.kind, markdown_url: `${base}/api/files/${file}`, file, type: f.type });
    }
  } catch {
    return json({ ok: false, error: "图片保存失败，请重试" }, 502, h);
  }

  // 身份：只有接入方后端签名的令牌才被信任；没有、过期或签名不对一律当普通用户。管理员提交的优先处理。
  let admin = false;
  let reporter = { id: report.user?.id, name: report.user?.name, email: report.user?.email || report.contact || undefined, verified: false };
  let identityNote: string | null = null;
  if (typeof body.identity === "string" && body.identity) {
    const r = await verifyIdentity(body.identity, source.identity_secret);
    if (r.ok) {
      admin = r.claims.role === "admin";
      reporter = { id: r.claims.id, name: r.claims.name ?? reporter.name, email: r.claims.email ?? reporter.email, verified: true };
    } else identityNote = r.reason;
  }

  try {
    const r = await submitFeedback({
      projectId: project.id,
      title: reportTitle(report),
      body: composeTaskBody(report, uploaded, { trusted: reporter.verified && admin }) + (reporter.verified ? `\n\n**提交者身份**：${admin ? "管理员（已验证，等同本人操作）" : "普通用户（已验证）"}` : identityNote ? `\n\n**提交者身份**：未验证（${identityNote}）` : ""),
      priority: admin ? "urgent" : "normal",
      source: "sdk",
      sourceRef: { reporter, role: admin ? "admin" : "user", page: report.env?.url ?? null, contact: report.contact || null, attachments: uploaded.map((u) => ({ file: u.file, name: u.name, kind: u.kind })), identityNote },
    });
    // task_id 字段名保留以兼容已部署的 SDK；值现在是反馈 ID（进度按它查）。进池等待时 pooled 有值
    return json({ ok: true, task_id: r.feedback.id, token: await statusToken(getEnv().BETTER_AUTH_SECRET, r.feedback.id), pooled: r.pooled }, 201, h);
  } catch (e) {
    return json({ ok: false, error: (e as Error).message }, 409, h);
  }
}
