// better-auth 实例工厂（不依赖 Cloudflare 运行时，Node 测试也能用）。
// 连接池按部署形态选择：Workers 用 Neon 的 WebSocket Pool（每请求新建），Node 用 node-postgres 连接池。
import { betterAuth } from "better-auth";
import { createAuthPool } from "#loop-auth-pool";

export interface AuthDeps {
  databaseUrl: string;
  secret: string;
  baseURL: string;
}

export function createAuth(deps: AuthDeps) {
  const { pool, close } = createAuthPool(deps.databaseUrl);
  const auth = betterAuth({
    database: pool,
    secret: deps.secret,
    baseURL: deps.baseURL,
    // 不开放注册：账号只由管理员用 scripts/create-user.mjs 创建
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 8, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24, cookieCache: { enabled: true, maxAge: 300 } },
  });
  return { auth, close };
}
export type Auth = ReturnType<typeof createAuth>["auth"];
