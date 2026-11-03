#!/usr/bin/env node
// 生成一次性测试仓库：带 AGENTS.md（测试/预览/发布命令）、一个可改的文件、一次初始提交。
// 用法：node scripts/make-fixture-repo.mjs <目标目录>
// 目标目录必须不存在或为空，避免误覆盖。仅用于联调，不要指向真实项目。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] ?? "");
if (!process.argv[2]) {
  console.error("用法：node scripts/make-fixture-repo.mjs <目标目录>");
  process.exit(1);
}
if (existsSync(dir) && readdirSync(dir).length > 0) {
  console.error(`目标目录非空，拒绝覆盖：${dir}`);
  process.exit(1);
}
mkdirSync(dir, { recursive: true });

const git = (...args) => execFileSync("git", args, { cwd: dir, stdio: ["ignore", "pipe", "pipe"] }).toString();
git("init", "-q", "-b", "main");
git("config", "user.email", "fixture@loop.local");
git("config", "user.name", "loop-fixture");

writeFileSync(join(dir, "a.txt"), "hello\n");
writeFileSync(
  join(dir, "AGENTS.md"),
  `# 测试夹具仓库

这是一次性测试仓库，用于联调，验证完即删除。

## 命令

- 测试：\`node -e "process.exit(require('fs').readFileSync('a.txt','utf8').length > 0 ? 0 : 1)"\`
- 预览：\`echo preview-ok\`
- 发布：\`echo publish-ok\`（以 SHA 为参数执行：\`echo publish-ok <sha>\`）
`,
);
git("add", "-A");
git("commit", "-q", "-m", "fixture: initial");
console.log(JSON.stringify({ dir, head: git("rev-parse", "HEAD").trim() }));
