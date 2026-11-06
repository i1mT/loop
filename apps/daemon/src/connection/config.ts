import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export interface Connection { gateway: string; token: string; machineId: string; name?: string }

export function gatewayUrl(input: string): string {
  const url = new URL(input);
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash || (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) throw new Error("请输入 HTTPS 网站地址；本机测试允许 http://localhost");
  return url.origin;
}

export function readConnection(dataDir: string): Connection | null {
  try { return JSON.parse(readFileSync(join(dataDir, "connection.json"), "utf8")) as Connection; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw new Error("无法读取连接配置，请重新连接机器"); }
}

export function saveConnection(dataDir: string, config: Connection): void {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const target = join(dataDir, "connection.json");
  const tmp = `${target}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(config), { mode: 0o600, flag: "wx" });
  chmodSync(tmp, 0o600);
  renameSync(tmp, target);
}
