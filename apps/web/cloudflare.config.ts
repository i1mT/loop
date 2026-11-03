// Loop 网关的 Cloudflare 配置（vinext 的 Cloudflare 插件读取这个文件，不要改回 wrangler.jsonc）。
// 部署参数通过环境配置，本地密钥从 .dev.vars 读取。
// 令牌与 DATABASE_URL 只通过 Worker Secrets（cf deploy --secrets-file）写入，不入库。
import { bindings, defineConfig, defineWorker, triggers } from "cf/config";

export default defineConfig({
  accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
  worker: defineWorker({
    name: process.env.LOOP_WORKER_NAME ?? "loop",
    domains: process.env.LOOP_DOMAIN ? [process.env.LOOP_DOMAIN] : [],
    entrypoint: "./worker.ts",
    triggers: [triggers.scheduled({ schedule: "* * * * *" })],
    // 数据库（Neon）在 AWS 新加坡：把 Worker 放到离它近的地方，一次请求里的多次查库就是近距离往返
    placement: { region: "aws:ap-southeast-1" },
    compatibilityDate: "2026-10-16",
    compatibilityFlags: ["nodejs_compat"],
    assets: {
      htmlHandling: "none",
      notFoundHandling: "none",
      runWorkerFirst: ["/*", "!/_next/static/*", "!/*/_next/static/*"],
    },
    env: {
      ASSETS: bindings.assets(),
      // 数据库已从 D1 换成 Neon Postgres（新加坡）：连接串是 Worker Secret，不入库
      DATABASE_URL: bindings.secret(),
      LOOP_PUBLIC_URL: bindings.text(
        process.env.LOOP_PUBLIC_URL ?? "http://localhost:5190",
      ),
      FILES: bindings.r2({
        name: process.env.LOOP_FILES_BUCKET ?? "loop-files",
      }),
      // 本地模式配置（JSON）：云端部署时填 {}；本地在 .dev.vars.localweb 里填上游地址、云端令牌与本机机器 ID
      LOOP_LOCAL: bindings.secret(),
      BETTER_AUTH_SECRET: bindings.secret(),
      LOOP_ADMIN_TOKEN: bindings.secret(),
      LOOP_DAEMON_TOKEN: bindings.secret(),
      // 判定反馈规模（小问题合并）；部署时在 secrets 文件里提供
      TYPESAFE_API_KEY: bindings.secret(),
      // 空间飞书凭证的 AES-GCM 主密钥（32 字节 base64），与应用凭证分开保存
      FEISHU_ENCRYPTION_KEY: bindings.secret(),
    },
  }),
});
