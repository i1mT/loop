#!/usr/bin/env node
import { Db } from "../apps/web/lib/pg.ts";
import { migrate } from "../apps/web/lib/migrations.ts";
import { localConfig } from "./lib/config.mjs";
const url = process.env.DATABASE_URL ?? localConfig().DATABASE_URL;
if (!url) {
  console.error("缺少 DATABASE_URL；请明确指定要迁移的数据库。");
  process.exit(1);
}
try {
  const version = await migrate(new Db(url));
  console.log(`数据库迁移完成，版本 ${version}`);
} catch {
  console.error("数据库迁移失败，请检查连接、权限和数据库状态。");
  process.exitCode = 1;
}
