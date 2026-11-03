// 服务端认证：云端用 better-auth（邮箱 + 密码，Neon 存储）；本地模式用本机签名 cookie。
import { createAuth, type Auth } from "./auth-factory.ts";
import { getEnv } from "./env.ts";
import { parseLocalConfig } from "./local-mode.ts";
import { LOCAL_COOKIE, verifyLocalSession } from "./local-session.ts";

export const isLocalMode = (): boolean => parseLocalConfig(getEnv().LOOP_LOCAL) !== null;

/** 每个请求新建一个 better-auth 实例（Workers 里数据库连接不能跨请求复用），用完关闭连接 */
export async function withAuth<T>(origin: string, fn: (auth: Auth) => Promise<T>): Promise<T> {
  const env = getEnv();
  const { auth, close } = createAuth({ databaseUrl: env.DATABASE_URL, secret: env.BETTER_AUTH_SECRET, baseURL: origin });
  try {
    return await fn(auth);
  } finally {
    await close();
  }
}

function cookieValue(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

export interface SessionUser {
  id: string | null;
  email: string;
  name: string;
}

/** 当前登录的用户（浏览器会话）。没有登录返回 null。 */
export async function sessionUser(headers: Headers, origin: string): Promise<SessionUser | null> {
  if (isLocalMode()) {
    const email = await verifyLocalSession(getEnv().LOOP_ADMIN_TOKEN, cookieValue(headers, LOCAL_COOKIE));
    return email ? { id: null, email, name: email.split("@")[0] } : null;
  }
  // 没有任何 better-auth cookie 时不必建连接
  if (!(headers.get("cookie") ?? "").includes("better-auth")) return null;
  return withAuth(origin, async (auth) => {
    const s = await auth.api.getSession({ headers });
    return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
  });
}
