// 测试用的一次性仓库与假智能体规格。仅在 *.test.ts 中使用。
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSpec } from "../acp/agent-conn.ts";

export function tempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();
}

/** 在 main 分支上建一个带一个文件的仓库 */
export function makeRepo(): string {
  const dir = tempDir("loopd-repo-");
  git(dir, "init", "-q", "-b", "main");
  git(dir, "config", "user.email", "t@loop.local");
  git(dir, "config", "user.name", "loopd-test");
  writeFileSync(join(dir, "a.txt"), "hello\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "init");
  return dir;
}

export const FAKE_SPEC: AgentSpec = {
  kind: "fake",
  command: process.execPath,
  args: ["--experimental-strip-types", "--no-warnings", new URL("./fake-agent.ts", import.meta.url).pathname],
};
