import { getEnv } from "@/lib/env.ts";
import { fail, json, requireRole } from "@/lib/http.ts";

const MAX_FILE = 5 * 1024 * 1024;
const IMAGE_EXT: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp" };

// 管理员在网页上写任务时粘贴/拖入的图片：请求体就是图片本身（content-type 为图片类型），存进 R2，
// 返回不可猜的链接（与 SDK 反馈的图片同一个存储与读取接口）。
export async function POST(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const type = (req.headers.get("content-type") ?? "").split(";")[0].trim();
  const ext = IMAGE_EXT[type];
  if (!ext) return fail(400, "只支持 PNG、JPEG、GIF、WebP 图片");
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (!bytes.byteLength) return fail(400, "图片为空");
  if (bytes.byteLength > MAX_FILE) return fail(413, "图片不能超过 5MB");
  const file = `img_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}.${ext}`;
  try {
    await getEnv().FILES.put(file, bytes, { httpMetadata: { contentType: type } });
  } catch {
    return fail(502, "图片保存失败，请重试");
  }
  return json({ ok: true, url: `${new URL(req.url).origin}/api/files/${file}`, file }, 201);
}
