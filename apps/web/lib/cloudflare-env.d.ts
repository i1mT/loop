// 本地类型补充：Worker 运行时模块 cloudflare:workers（由 Cloudflare 插件在构建时提供）
declare module "cloudflare:workers" {
  export const env: Record<string, unknown>;
}
