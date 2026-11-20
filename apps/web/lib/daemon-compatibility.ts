import daemonPackage from "../../daemon/package.json" with { type: "json" };
import { DAEMON_CAPABILITIES, compareDaemonVersions, type DaemonCapabilities, type DaemonCapability } from "@loop/core";
import type { Db } from "./pg.ts";

export const RECOMMENDED_DAEMON_VERSION = daemonPackage.version;

export function daemonUpdateVersion(version: string | null): string | null {
  return compareDaemonVersions(version, RECOMMENDED_DAEMON_VERSION) === -1 ? RECOMMENDED_DAEMON_VERSION : null;
}

// 领取条件和任务页面使用同一份能力要求。
const requirements: Record<DaemonCapability, { task: string; project: string }> = {
  technicalPlan: {
    task: "EXISTS (SELECT 1 FROM task_plan_rounds r WHERE r.task_id=t.id AND r.round=t.round)",
    project: "p.delivery_settings IS NOT NULL OR EXISTS (SELECT 1 FROM space_feishu_bindings f WHERE f.space_id=p.space_id AND f.enabled=1)",
  },
  delivery: {
    task: "EXISTS (SELECT 1 FROM task_delivery d WHERE d.task_id=t.id AND d.round=t.round)",
    project: "p.delivery_settings IS NOT NULL",
  },
};
const capabilityNames = Object.keys(DAEMON_CAPABILITIES) as DaemonCapability[];

export function claimCompatibilitySql(capabilities: DaemonCapabilities): string {
  return capabilityNames.filter((key) => capabilities[key] !== true)
    .map((key) => ` AND NOT ${requirements[key].task}`).join("");
}

// 调度保留不兼容的绑定作为最后选择，用户仍可创建任务并在原机器升级后接着跑。
export const projectCompatibilitySql = `CASE WHEN m.capabilities IS NULL THEN 1 WHEN ${capabilityNames
  .map((key) => `((${requirements[key].project}) AND m.capabilities->>'${key}' IS DISTINCT FROM 'true')`)
  .join(" OR ")} THEN 2 ELSE 0 END`;

export function missingDaemonCapabilities(capabilities: DaemonCapabilities | null): DaemonCapability[] {
  return capabilities === null ? [] : capabilityNames.filter((key) => capabilities[key] !== true);
}

export async function taskDaemonUpdate(db: Db, taskId: string) {
  const required = capabilityNames.map((key) => `${requirements[key].task} AS "${key}"`);
  const row = await db.prepare(`SELECT m.id,m.name,m.version,m.capabilities,${required.join(",")}
    FROM tasks t JOIN machines m ON m.id=t.machine_id
    WHERE t.id=? AND t.stage NOT IN ('published','rejected','failed','cancelled')`).bind(taskId)
    .first<Record<DaemonCapability, boolean> & { id: string; name: string; version: string | null; capabilities: DaemonCapabilities | null }>();
  if (!row) return null;
  const missing = missingDaemonCapabilities(row.capabilities).filter((key) => row[key]);
  return missing.length ? { machineId: row.id, machineName: row.name, version: row.version, missing } : null;
}
