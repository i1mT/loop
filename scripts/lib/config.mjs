import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** 只读取部署者显式配置的文件，不从其他项目或生产环境寻找凭证。 */
export function localConfig() {
  const file =
    process.env.LOOP_CONFIG_PATH ?? join(homedir(), ".config/loop/loop.env");
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .flatMap((line) => {
        const match = line.match(/^([A-Z_]+)=(.*)$/);
        if (!match) return [];
        let value = match[2].trim();
        if (
          (value.startsWith("'") && value.endsWith("'")) ||
          (value.startsWith('"') && value.endsWith('"'))
        )
          value = value.slice(1, -1);
        return [[match[1], value]];
      }),
  );
}
