import { getEnv } from "@/lib/env.ts";
import { fail, json, readJson } from "@/lib/http.ts";
import type { UploadedPart } from "@/lib/object-store.ts";

const validFile = (name: string) => name === "manifest.json" || /^loopd-[a-zA-Z0-9.-]+-(darwin|linux)-(arm64|x64)\.tar\.gz$/.test(name);
const key = (file: string) => `daemon-releases/${file}`;

export async function GET(req: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const files = getEnv().FILES;
  if (file === "latest") {
    const target = new URL(req.url).searchParams.get("target") ?? "";
    if (!/^(darwin|linux)-(arm64|x64)$/.test(target)) return fail(400, "不支持的平台");
    const manifest = await files.get(key("manifest.json"));
    const data = manifest ? await new Response(manifest.body).json<Record<string, { version: string; file: string; sha256: string }>>() : {};
    const release = data[target];
    if (!release) return fail(404, "该平台的安装包尚未发布");
    return new Response(`${release.version} ${release.file} ${release.sha256}\n`, { headers: { "content-type": "text/plain", "cache-control": "no-store" } });
  }
  if (!validFile(file)) return fail(404, "不存在");
  const object = await files.get(key(file));
  if (!object) return fail(404, "安装包不存在");
  return new Response(object.body, { headers: { "content-type": file.endsWith(".json") ? "application/json" : "application/gzip", "content-length": String(object.size), "etag": object.httpEtag, "cache-control": file === "manifest.json" ? "no-store" : "public, max-age=31536000, immutable" } });
}

// 下载与发布工具可在不读取整个对象的情况下确认已完成上传。
export async function HEAD(_req: Request, { params }: { params: Promise<{ file: string }> }) {
  const {file}=await params;
  if (!validFile(file)) return new Response(null,{status:404});
  const object=await getEnv().FILES.head(key(file));
  if (!object) return new Response(null,{status:404});
  return new Response(null,{headers:{"content-length":String(object.size),"x-loop-sha256":object.customMetadata?.sha256 ?? "","cache-control":"no-store"}});
}

// 发布工具仅使用服务端管理员令牌；普通登录账号不能上传可执行文件。
function publisher(req: Request): boolean {
  const secret = getEnv().LOOP_ADMIN_TOKEN;
  return !!secret && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function POST(req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!publisher(req)) return fail(403, "没有发布权限");
  const { file } = await params;
  if (!validFile(file)) return fail(400, "文件名称无效");
  const bucket = getEnv().FILES;
  const action = new URL(req.url).searchParams.get("action");
  if (action === "create" && file !== "manifest.json") {
    const metadata=await readJson<{sha256?: string}>(req);
    if (metadata?.sha256 != null && !/^[a-f0-9]{64}$/.test(metadata.sha256)) return fail(400,"摘要无效");
    const upload = await bucket.createMultipartUpload(key(file), { httpMetadata: { contentType: "application/gzip" }, customMetadata: {sha256:metadata?.sha256 ?? ""} });
    return json({ uploadId: upload.uploadId });
  }
  const body = await readJson<{ uploadId?: string; parts?: UploadedPart[] }>(req);
  if (!body?.uploadId) return fail(400, "需要 uploadId");
  const upload = await bucket.resumeMultipartUpload(key(file), body.uploadId);
  if (action === "abort") { await upload.abort(); return json({ ok: true }); }
  if (action !== "complete" || !Array.isArray(body.parts)) return fail(400, "需要上传分片");
  await upload.complete(body.parts);
  return json({ ok: true });
}

export async function PUT(req: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!publisher(req)) return fail(403, "没有发布权限");
  const { file } = await params;
  if (!validFile(file) || !req.body) return fail(400, "文件无效");
  const bucket = getEnv().FILES;
  if (file === "manifest.json") {
    const data = await readJson<Record<string, { version: string; file: string; sha256: string }>>(req);
    if (!data || Object.entries(data).some(([target, value]) => !/^(darwin|linux)-(arm64|x64)$/.test(target) || !/^[a-zA-Z0-9.-]+$/.test(value.version) || !validFile(value.file) || !/^[a-f0-9]{64}$/.test(value.sha256))) return fail(400, "发布清单无效");
    for (const value of Object.values(data)) if (!await bucket.head(key(value.file))) return fail(409, "请先上传全部安装包");
    await bucket.put(key(file), JSON.stringify(data), { httpMetadata: { contentType: "application/json" } });
    return json({ ok: true });
  }
  const url = new URL(req.url);
  const uploadId = url.searchParams.get("uploadId");
  const partNumber = Number(url.searchParams.get("partNumber"));
  if (!uploadId || !Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10000) return fail(400, "分片无效");
  const upload = await bucket.resumeMultipartUpload(key(file), uploadId);
  return json(await upload.uploadPart(partNumber, req.body));
}
