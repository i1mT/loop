// 本地类型补充：Worker 运行时模块 cloudflare:workers（由 Cloudflare 插件在构建时提供）
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
  /** 请求结束后继续执行的后台任务（Workers 提供；Node 目标的同名模块在 lib/runtime/env.node.ts） */
  export function waitUntil(promise: Promise<unknown>): void;
}
