import type { DeliverySettings, TestEnvironment } from "@loop/core";

export function parseDeliverySettings(input: unknown): DeliverySettings | null {
  if (input === null) return null;
  if (typeof input !== "object" || !input) throw new Error("需要预览和生产环境设置");
  const { preview, production } = input as Partial<DeliverySettings>;
  const parse = (environment: TestEnvironment | undefined, label: string): TestEnvironment => {
    if (!environment || [environment.url, environment.username, environment.password, environment.workflow].some((v) => typeof v !== "string")) {
      throw new Error(`${label}设置格式不正确`);
    }
    const url = environment.url.trim();
    if (!URL.canParse(url) || !["http:", "https:"].includes(new URL(url).protocol)) {
      throw new Error(`请输入${label}的 HTTP 或 HTTPS 地址`);
    }
    return { url, username: environment.username.trim(), password: environment.password, workflow: environment.workflow.trim() };
  };
  return { preview: parse(preview, "预览环境"), production: parse(production, "生产环境") };
}
