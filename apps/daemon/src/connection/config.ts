import { mkdirSync, readFileSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { join } from "node:path";

export interface Connection { gateway: string; token: string; machineId: string; name?: string }

// 协议不由这里限制：自建网关常用 HTTP + IP 先跑通，是否上 HTTPS 由部署者决定。
// 只拒绝会把凭证带进地址或不是网关根地址的写法。
export function gatewayUrl(input: string): string {
  const url = new URL(input);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new Error("请输入 HTTP(S) 网站地址，例如 http://118.196.30.108:3220");
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
