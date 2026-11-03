// workspace 消费 core 的构建产物，首次安装时也需要生成。
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../packages/core/package.json", import.meta.url),
);
execFileSync(
  process.execPath,
  [
    resolve(dirname(require.resolve("typescript/package.json")), "bin/tsc"),
    "-p",
    fileURLToPath(new URL("../packages/core/tsconfig.json", import.meta.url)),
  ],
  { stdio: "inherit" },
);
