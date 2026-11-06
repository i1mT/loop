import lockfile from "proper-lockfile";
import { closeSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export function runningPid(dataDir: string): number | null {
  try { const pid = Number(readFileSync(join(dataDir,"serve.pid"),"utf8")); if (!Number.isInteger(pid) || pid < 1) return null; process.kill(pid,0); return pid; }
  catch { return null; }
}

/** 独占启动，防止同一数据目录同时产生两个会话管理进程。 */
export function lockDaemon(dataDir: string): () => void {
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const file = join(dataDir,"serve.pid");
  if (runningPid(dataDir)) throw new Error("守护进程已经运行，请先执行 loopd stop");
  let release: () => void;
  try { release=lockfile.lockSync(dataDir,{lockfilePath:join(dataDir,"serve.lock"),stale:120000,update:10000,retries:0}); }
  catch { throw new Error("守护进程已经运行，或上次异常退出的锁尚未释放。请等待两分钟后重试"); }
  try {writeFileSync(file,String(process.pid),{mode:0o600});}
  catch(error) {release();throw error;}
  return () => { try {if (readFileSync(file,"utf8") === String(process.pid)) unlinkSync(file);} finally {release();} };
}

export async function startDaemon(dataDir: string): Promise<void> {
  if (runningPid(dataDir)) { console.log("守护进程已经运行。"); return; }
  mkdirSync(dataDir,{recursive:true,mode:0o700});
  const log = openSync(join(dataDir,"daemon.log"),"a",0o600);
  const entry = fileURLToPath(new URL(import.meta.url.endsWith(".ts") ? "../cli.ts" : "../cli.js",import.meta.url));
  const child = spawn(process.execPath,[entry,"serve"],{detached:true,stdio:["ignore",log,log],env:{...process.env,LOOPD_HOME:dataDir}});
  closeSync(log); child.unref();
  await new Promise<void>((resolve,reject)=>{child.once("spawn",resolve);child.once("error",reject);});
  for (let i=0;i<50;i++) {
    if (runningPid(dataDir)) { console.log(`守护进程已在后台启动。日志：${join(dataDir,"daemon.log")}`); return; }
    if (child.exitCode !== null) break;
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  throw new Error(`启动失败，请检查 ${join(dataDir,"daemon.log")}`);
}
