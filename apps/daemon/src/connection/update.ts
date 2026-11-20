import { compareDaemonVersions } from "@loop/core";
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { LOOPD_RELEASE } from "./version.ts";

const run = promisify(execFile);
export function releaseToInstall(current: string, remote: string): boolean {
  const comparison = compareDaemonVersions(current, remote);
  return current !== remote && comparison !== null && comparison <= 0;
}

function replaceLauncher(path: string, content: string) {
  const temp = mkdtempSync(join(dirname(path), ".loopd-"));
  try {
    const file = join(temp, "loopd");
    writeFileSync(file, content, { mode: 0o700 });
    renameSync(file, path);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}

/** 下载期间旧版仍运行。返回的操作在旧版释放进程锁后才执行。 */
export function portableUpdates(gateway: string, dataDir: string) {
  const installed = LOOPD_RELEASE;
  if (!installed || process.env.LOOPD_MANAGED !== "1" || process.env.LOOPD_AUTO_UPDATE === "0" || !gateway.startsWith("https://")) return undefined;
  return portableUpdater({
    gateway, dataDir, installed, home: homedir(),
    installer: fileURLToPath(new URL("../../install.sh", import.meta.url)),
  });
}

export function portableUpdater({ gateway, dataDir, installed, home, installer }: {
  gateway: string;
  dataDir: string;
  installed: string;
  home: string;
  installer: string;
}) {
  const root = join(home, ".local", "share", "loop", "versions");
  const launcher = join(home, ".local", "bin", "loopd");
  const currentBin = join(root, installed, "bin", "loopd");
  if (!existsSync(installer) || !existsSync(currentBin) || !existsSync(launcher)) return undefined;
  const failurePath = join(dataDir, "update-failed-version");
  return async () => {
    const previous = readFileSync(launcher, "utf8");
    if (!previous.includes(currentBin.replaceAll("'", "'\\''"))) return null;
    const target = `${process.platform}-${process.arch}`;
    const response = await fetch(`${gateway}/api/daemon-releases/latest?target=${target}`, { signal: AbortSignal.timeout(10_000) });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`无法读取守护进程版本（HTTP ${response.status}）`);
    const [version] = (await response.text()).trim().split(/\s+/);
    if (!version || !releaseToInstall(installed, version) || (existsSync(failurePath) && readFileSync(failurePath, "utf8") === version)) return null;
    await run("/bin/sh", [installer, "--gateway", gateway, "--prepare", version], { env: { ...process.env, HOME: home }, timeout: 120_000 });
    const candidate = join(root, version, "bin", "loopd");
    const { stdout } = await run(candidate, ["--version"], { timeout: 10_000 });
    if (stdout.trim() !== `loopd ${version}`) throw new Error("安装包版本与清单不一致");
    return async () => {
      const start = (binary: string) => run(binary, ["start"], { env: { ...process.env, LOOPD_HOME: dataDir }, timeout: 10_000 });
      const assignedLauncher = readFileSync(launcher, "utf8");
      if (assignedLauncher !== previous) {
        await start(launcher);
        return;
      }
      try {
        replaceLauncher(launcher, `#!/bin/sh\nexec '${candidate.replaceAll("'", "'\\''")}' "$@"\n`);
        await start(candidate);
      } catch (error) {
        replaceLauncher(launcher, previous);
        writeFileSync(failurePath, version, { mode: 0o600 });
        await start(currentBin);
        throw error;
      }
    };
  };
}
