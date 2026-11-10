// 运行环境读取：Workers 从 cloudflare:workers 的 env 绑定读，Node 从 process.env 读。
// 两条构建各自只打包自己的实现（见 package.json 的 imports 条件），互不引入对方的运行时依赖。
import { env, waitUntil as workersWaitUntil } from "cloudflare:workers";

/** 读取原始环境变量表；Node 端返回 process.env。 */
export function rawEnv(): Record<string, unknown> {
  return env as unknown as Record<string, unknown>;
}

/** 当前是否运行在 Workers 上（用于选择驱动，不代表部署形态）。 */
export const isWorkersRuntime = true;

/** 请求结束后的后台任务。Workers 交给平台的 waitUntil；Node 端见 env.node.ts。 */
export const waitUntil = workersWaitUntil as (promise: Promise<unknown>) => void;
