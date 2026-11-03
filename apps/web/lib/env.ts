import { env } from "cloudflare:workers";

export interface GatewayEnv {
  /** Neon Postgres 连接串（池化）。云端是 Worker Secret，本地在 .dev.vars。不入库。 */
  DATABASE_URL: string;
  /** 对外可访问的网关地址，用于后台通知。 */
  LOOP_PUBLIC_URL: string;
  FILES: R2Bucket;
  /** API 令牌：脚本与本地网关调用云端接口用（Bearer），不能用来登录页面。本地模式下它是本机 cookie 的签名密钥。 */
  LOOP_ADMIN_TOKEN: string;
  /** 守护进程令牌（领取、回传事件、读取收件箱）。 */
  LOOP_DAEMON_TOKEN: string;
  /** better-auth 的签名密钥（云端 Worker Secret）。 */
  BETTER_AUTH_SECRET: string;
  /** Typesafe Jev 的密钥（判定反馈规模用）。没配置时小问题合并不生效，所有反馈照常直接建任务。 */
  TYPESAFE_API_KEY?: string;
  /** 飞书应用凭证加密主密钥（32 字节 base64）。 */
  FEISHU_ENCRYPTION_KEY?: string;
  /** 本地模式配置（JSON 字符串）。云端是 "{}"。见 lib/local-mode.ts */
  LOOP_LOCAL?: string;
}

export function getEnv(): GatewayEnv {
  return env as unknown as GatewayEnv;
}
