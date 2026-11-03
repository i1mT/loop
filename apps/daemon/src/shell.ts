// 在指定目录运行 shell 命令（命令来自项目自己的 AGENTS.md，视为项目受信配置）。超时则杀掉整组。
import { spawn } from "node:child_process";

export interface ShellResult {
  code: number | null;
  timedOut: boolean;
  output: string;
}

export function runShell(cmd: string, cwd: string, timeoutMs: number, extraArgs: string[] = []): Promise<ShellResult> {
  return new Promise((resolve) => {
    const full = [cmd, ...extraArgs.map((a) => shellQuote(a))].join(" ");
    const child = spawn("sh", ["-c", full], { cwd, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    const take = (d: Buffer) => {
      output += d.toString();
      if (output.length > 200_000) output = output.slice(-200_000);
    };
    child.stdout?.on("data", take);
    child.stderr?.on("data", take);
    let timedOut = false;
    const t = setTimeout(() => {
      timedOut = true;
      killGroup(child.pid, "SIGKILL");
    }, timeoutMs);
    child.on("close", (code) => {
      clearTimeout(t);
      killGroup(child.pid, "SIGKILL"); // 收尾：组内残留进程一并结束
      resolve({ code, timedOut, output });
    });
  });
}

function killGroup(pid: number | undefined, sig: NodeJS.Signals): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, sig);
  } catch {
    // 已不存在
  }
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
