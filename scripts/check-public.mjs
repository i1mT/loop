// 发布与 CI 共用：只检查 Git 跟踪文件，不读取本机环境文件。
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const files = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
  .split("\0")
  .filter(Boolean);
const errors = [];
for (const file of files) {
  const base = file.split("/").pop();
  if (
    ((base.startsWith(".env") || base.startsWith(".dev.vars")) &&
      !base.endsWith(".example")) ||
    base === ".neon" ||
    /\.(?:log|pem|key|sqlite)$/.test(base)
  )
    errors.push(`${file}: 不应提交环境、日志或私钥文件`);
  if (/\.(?:png|jpg|jpeg|gif|webp|woff2?)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  if (/\/Users\/[^\s"'`<>]+/.test(text))
    errors.push(`${file}: 包含本机绝对路径`);
  if (
    /(?:ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----)/.test(
      text,
    )
  )
    errors.push(`${file}: 包含凭证特征，需要人工检查`);
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    `公开文件检查通过：${files.length} 个文件。另需对图片和 Git 历史执行秘密检查。`,
  );
