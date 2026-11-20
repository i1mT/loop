import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const REPORT_TOOL = "report_environment_test";
export const VERDICTS = ["passed", "failed", "blocked"] as const;
export interface TestReport {
  verdict: typeof VERDICTS[number];
  summary: string;
}

export function validateReport(input: unknown): TestReport {
  const { verdict, summary } = (input ?? {}) as Partial<TestReport>;
  if (!verdict || !VERDICTS.includes(verdict)) throw new Error("verdict 必须是 passed、failed 或 blocked");
  if (typeof summary !== "string" || !summary.trim() || summary.length > 8000)
    throw new Error("summary 必须是 1 至 8000 个字符的测试摘要");
  return { verdict, summary: summary.trim() };
}

export function readReport(dir: string): TestReport | null {
  try {
    return validateReport(JSON.parse(readFileSync(join(dir, "result.json"), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/** 先写完整结果，再原子发布。重复提交相同的结论可成功返回。 */
export function submitReport(dir: string, input: unknown): void {
  const report = validateReport(input);
  const temp = join(dir, randomUUID());
  writeFileSync(temp, JSON.stringify(report), { flag: "wx", mode: 0o600 });
  try {
    linkSync(temp, join(dir, "result.json"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const existing = readReport(dir);
    if (existing?.verdict !== report.verdict || existing.summary !== report.summary)
      throw new Error("本次测试已有结论，不能覆盖");
  } finally {
    unlinkSync(temp);
  }
}
