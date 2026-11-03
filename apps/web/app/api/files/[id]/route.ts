import { getEnv } from "@/lib/env.ts";

// 反馈里的图片。对象名是随机的、不可猜，作为能力链接给后台和智能体查看；只读，只认固定格式的名字。
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^img_[0-9a-f]{16}\.(jpg|png|gif|webp)$/.test(id)) return new Response("not found", { status: 404 });
  const obj = await getEnv().FILES.get(id);
  if (!obj) return new Response("not found", { status: 404 });
  return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType ?? "application/octet-stream", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
}
