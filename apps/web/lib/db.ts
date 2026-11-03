// 数据库入口：Neon Postgres。首次使用时按需迁移（每个 isolate 只检查一次）。
import { migrate } from "./migrations.ts";
import { Db } from "./pg.ts";

let migrated = false;
let cached: Db | null = null;

/** 测试用：注入一个已连好的数据库（集成测试里不经过 Worker 运行时） */
export function useDb(db: Db): void {
  cached = db;
  migrated = true;
}

export async function getDb(): Promise<Db> {
  if (cached && migrated) return cached;
  // 懒加载：env.ts 依赖 Worker 运行时模块，测试环境里不可用
  const { getEnv } = await import("./env.ts");
  const url = getEnv().DATABASE_URL;
  if (!url) throw new Error("缺少 DATABASE_URL（Neon 连接串）");
  if (!cached) cached = new Db(url);
  if (!migrated) {
    await migrate(cached);
    migrated = true;
  }
  return cached;
}

export const now = () => Date.now();
export const newId = () => crypto.randomUUID();
