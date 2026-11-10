// 网关配置：Workers 从 Worker Secret / 绑定读取，Node 从环境变量读取（见 lib/runtime/*）。
// 对象存储按部署形态选择：Workers 用 R2 绑定，Node 用 S3（含兼容端点）。业务代码只拿到窄接口。
import type { ObjectStore } from "./object-store.ts";
import { objectStoreFromEnv } from "#loop-object-store";
import { rawEnv } from "#loop-runtime-env";

export interface GatewayEnv {
  /** Postgres 连接串（池化）。云端是 Worker Secret，本地在 .dev.vars，Node 部署在 .env。不入库。 */
  DATABASE_URL: string;
  /** 对外可访问的网关地址，用于后台通知。 */
  LOOP_PUBLIC_URL: string;
  /** 对象存储（R2 或 S3）；不是 Worker 绑定，而是按部署形态构造好的读取器。 */
  FILES: ObjectStore;
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

/** 读取字符串配置；空字符串按未配置处理，避免把空值当成有效密钥。 */
const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** 每个进程/isolate 只构造一次存储客户端（S3 客户端与连接池都不该按请求重建）。 */
let files: ObjectStore | null = null;

/** 惰性构造存储：没有配置对象存储的脚本与测试（迁移、账号创建）不该被迫连接存储。 */
function filesStore(): ObjectStore {
  return (files ??= objectStoreFromEnv());
}

export function getEnv(): GatewayEnv {
  const env = rawEnv();
  return {
    DATABASE_URL: text(env.DATABASE_URL),
    LOOP_PUBLIC_URL: text(env.LOOP_PUBLIC_URL),
    get FILES() {
      return filesStore();
    },
    LOOP_ADMIN_TOKEN: text(env.LOOP_ADMIN_TOKEN),
    LOOP_DAEMON_TOKEN: text(env.LOOP_DAEMON_TOKEN),
    BETTER_AUTH_SECRET: text(env.BETTER_AUTH_SECRET),
    TYPESAFE_API_KEY: text(env.TYPESAFE_API_KEY) || undefined,
    FEISHU_ENCRYPTION_KEY: text(env.FEISHU_ENCRYPTION_KEY) || undefined,
    LOOP_LOCAL: text(env.LOOP_LOCAL) || undefined,
  };
}
