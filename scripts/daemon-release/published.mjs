// 检查网关上发布的 daemon 安装包是否包含仓库里的最新 daemon 代码。
// 命令行：node scripts/daemon-release/published.mjs <网关地址> [平台,平台…]（默认 darwin-arm64），过期时退出码为 1。
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 这些路径会进入便携包；只改网页、文档或测试不需要重新发布。
export function isPackagedPath(file) {
  if (/\.test\.(ts|mjs|js)$/.test(file) || file.includes('/testing/')) return false;
  return file.startsWith('apps/daemon/') || file.startsWith('packages/core/')
    || ['apps/web/public/install.sh', 'pnpm-lock.yaml', 'scripts/daemon-release/build.mjs'].includes(file);
}

/** 清单一行格式：`<版本> <文件名> <sha256>`，版本为 `<package 版本>-<提交>`。 */
export function parseRelease(text) {
  const [version, file, sha] = String(text).trim().split(/\s+/);
  const match = /^(\d+)\.(\d+)\.(\d+)-([0-9a-f]{7,40})$/.exec(version ?? '');
  if (!match || !file || !/^[0-9a-f]{64}$/.test(sha ?? '')) return null;
  return { version, file, sha, base: match.slice(1, 4).map(Number), commit: match[4] };
}

function compareBase(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return Math.sign(a[i] - b[i]);
  return 0;
}

/**
 * published：线上清单文本（没有该平台时为 null）。
 * localVersion：apps/daemon/package.json 的版本。
 * changedFiles：已发布提交到当前 HEAD 改动的文件；本地没有这个提交时为 null。
 */
export function checkPublished({ published, localVersion, changedFiles }) {
  const release = published ? parseRelease(published) : null;
  if (!release) return { ok: false, reason: '线上清单没有这个平台的安装包，或格式无法识别' };
  const local = /^(\d+)\.(\d+)\.(\d+)$/.exec(localVersion)?.slice(1, 4).map(Number);
  if (!local) return { ok: false, reason: `仓库 daemon 版本无效：${localVersion}` };
  if (compareBase(release.base, local) < 0) {
    return { ok: false, reason: `已发布 ${release.version}，仓库版本是 ${localVersion}` };
  }
  if (changedFiles === null) {
    return { ok: false, reason: `本地找不到已发布的提交 ${release.commit}，无法确认是否最新` };
  }
  const packaged = changedFiles.filter(isPackagedPath);
  if (packaged.length) {
    const shown = packaged.slice(0, 5).join('、') + (packaged.length > 5 ? ` 等 ${packaged.length} 个文件` : '');
    return { ok: false, reason: `已发布 ${release.version} 之后 daemon 相关文件有改动：${shown}` };
  }
  return { ok: true, reason: `已发布 ${release.version}，之后没有 daemon 相关改动` };
}

function changedSince(root, commit) {
  try {
    return execFileSync('git', ['diff', '--name-only', commit, 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .split('\n').filter(Boolean);
  } catch {
    return null;
  }
}

async function main() {
  const gateway = process.argv[2]?.replace(/\/+$/, '');
  if (!gateway) throw new Error('用法：published.mjs <网关地址> [平台,平台…]');
  const targets = (process.argv[3] ?? 'darwin-arm64').split(',');
  const root = resolve(import.meta.dirname, '../..');
  const localVersion = JSON.parse(readFileSync(resolve(root, 'apps/daemon/package.json'), 'utf8')).version;
  let failed = false;
  for (const target of targets) {
    const response = await fetch(`${gateway}/api/daemon-releases/latest?target=${target}`, { signal: AbortSignal.timeout(15000) });
    const published = response.ok ? await response.text() : null;
    const release = published ? parseRelease(published) : null;
    const result = checkPublished({ published, localVersion, changedFiles: release ? changedSince(root, release.commit) : [] });
    console.log(`${result.ok ? '最新' : '过期'} ${target}：${result.reason}`);
    failed ||= !result.ok;
  }
  process.exit(failed ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
