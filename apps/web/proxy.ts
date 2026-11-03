// 本地模式（配置了 LOOP_LOCAL）：把 /api/* 转发到云端；云端模式下什么都不做。
import { NextResponse, type NextRequest } from "next/server";
import { sessionUser } from "@/lib/auth-server.ts";
import { getEnv } from "@/lib/env.ts";
import { parseLocalConfig } from "@/lib/local-mode.ts";
import { isDaemonPath, shouldForward, upstreamHeaders, upstreamUrl } from "@/lib/upstream.ts";

export const config = { matcher: ["/api/:path*"] };

const err = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function proxy(req: NextRequest) {
  const local = parseLocalConfig(getEnv().LOOP_LOCAL);
  if (!local) return NextResponse.next();
  const { pathname, search } = req.nextUrl;
  if (isDaemonPath(pathname)) return err(404, "本地网关不提供守护进程接口：守护进程直接连接云端");
  if (!shouldForward(pathname)) return NextResponse.next();

  // 本地登录：浏览器只持有本机签名的会话 cookie（登录时由云端验证邮箱与密码）
  const user = await sessionUser(req.headers, req.nextUrl.origin);
  if (!user) return err(401, "未认证");

  const hasBody = !["GET", "HEAD"].includes(req.method);
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const send = () => {
    const headers = upstreamHeaders(req.headers, local.upstreamToken);
    headers.set("x-loop-user", user.email);
    return fetch(upstreamUrl(local.upstream, pathname, search), {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
  };
  let res: Response;
  try {
    res = await send();
  } catch {
    // 网络瞬时失败：只读请求再试一次；写请求不重试（避免重复创建）
    if (hasBody) return err(502, "无法连接到云端，请检查网络");
    try {
      res = await send();
    } catch {
      return err(502, "无法连接到云端，请检查网络");
    }
  }
  const headers = new Headers();
  const ct = res.headers.get("content-type");
  if (ct) headers.set("content-type", ct);
  headers.set("cache-control", "no-store");
  return new Response(res.body, { status: res.status, headers });
}
