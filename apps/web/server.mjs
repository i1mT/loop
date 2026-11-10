#!/usr/bin/env node
// Node 自托管入口：先迁移数据库，再启动 vinext 生产服务器，并每分钟跑一次后台集成任务
// （与 Workers 的 scheduled trigger 等价）。进程由 Docker/systemd 托管，收到 SIGTERM 时优雅退出。
import { startProdServer } from "vinext/server/prod-server";

const here = new URL("./", import.meta.url).pathname;
const outDir = `${here}node/dist`;
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const host = process.env.HOST ?? "0.0.0.0";
const intervalMs = Number.parseInt(process.env.LOOP_INTEGRATION_INTERVAL_MS ?? "60000", 10);

const { runIntegrationsSafely } = await import("./lib/runtime/integrations.ts");
const { getDb } = await import("./lib/db.ts");
const { migrate } = await import("./lib/migrations.ts");

// 启动即迁移：与 Workers 首次请求时按需迁移同一套逻辑，这里提前做，失败直接退出。
try {
  const version = await migrate(await getDb());
  console.log(JSON.stringify({ event: "database_migrated", version }));
} catch {
  console.error(JSON.stringify({ event: "database_migration_failed" }));
  process.exit(1);
}

const { server, port: actualPort } = await startProdServer({ port, host, outDir });
console.log(JSON.stringify({ event: "server_listening", port: actualPort }));

let running = false;
const timer = setInterval(() => {
  // 上一轮还没结束就跳过，避免任务堆积。
  if (running) return;
  running = true;
  runIntegrationsSafely().finally(() => {
    running = false;
  });
}, intervalMs);
timer.unref?.();

function shutdown(signal) {
  clearInterval(timer);
  console.log(JSON.stringify({ event: "server_stopping", signal }));
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
