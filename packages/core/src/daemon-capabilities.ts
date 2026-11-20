/** 网关按任务需要的能力决定是否派发，版本号用于定位安装包。 */
export const DAEMON_CAPABILITIES = { technicalPlan: true, delivery: true } as const;
export type DaemonCapability = keyof typeof DAEMON_CAPABILITIES;
export type DaemonCapabilities = Partial<Record<DaemonCapability, boolean>>;


const versionPattern = /^(\d+)\.(\d+)\.(\d+)(?:-[a-zA-Z0-9.-]+)?$/;

export function daemonVersion(value: unknown): string | null {
  return typeof value === "string" && value.length <= 80 && versionPattern.test(value) ? value : null;
}

/** 便携包后缀是 Git 提交，版本先按主、次、修订号排序。 */
export function compareDaemonVersions(a: string | null, b: string): number | null {
  const current = a && versionPattern.exec(a);
  const target = versionPattern.exec(b);
  if (!current || !target) return null;
  for (let i = 1; i <= 3; i++) {
    const delta = Number(current[i]) - Number(target[i]);
    if (delta !== 0) return Math.sign(delta);
  }
  return 0;
}
