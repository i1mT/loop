// 对象存储入口：Workers 从 R2 绑定构造，Node 从 S3 环境变量构造（见 lib/runtime/*）。
// 两条构建各自只打包各自的实现。
import type { ObjectStore } from "../object-store.ts";
import { rawEnv } from "#loop-runtime-env";
import { r2ObjectStore } from "./r2.workers.ts";

export function objectStoreFromEnv(): ObjectStore {
  return r2ObjectStore(rawEnv().FILES as never);
}
