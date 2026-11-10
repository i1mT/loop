// 运行环境读取：Workers 从 cloudflare:workers 的 env 绑定读，Node 从 process.env 读。
// 两条构建各自只打包自己的实现（见 package.json 的 imports 条件），互不引入对方的运行时依赖。
export function rawEnv(): Record<string, unknown> {
  return process.env as unknown as Record<string, unknown>;
}

/** 当前是否运行在 Workers 上（用于选择驱动，不代表部署形态）。 */
export const isWorkersRuntime = false;

/** 请求结束后的后台任务：Node 没有 waitUntil，直接异步执行即可（进程常驻）。 */
export function waitUntil(promise: Promise<unknown>): void {
  promise.catch(() => undefined);
}
