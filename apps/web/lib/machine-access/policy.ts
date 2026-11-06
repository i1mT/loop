import type { Db } from "../pg.ts";

export interface MachineAccess { owner_user_id: string | null; shared: number | null }

export function machinePermission(machine: MachineAccess | null, userId: string | null, manage = false): boolean {
  if (!machine || !userId) return false;
  return machine.owner_user_id === userId || (!manage && !!machine.shared);
}

/** 空间成员身份由请求认证检查；这里只检查机器所有权和当前空间的共享授权。 */
export async function canUseMachine(db: Db, machineId: string, userId: string | null, spaceId: string, manage = false): Promise<boolean> {
  const row = await db.prepare(`SELECT m.owner_user_id, s.shared FROM machines m
    LEFT JOIN space_machines s ON s.machine_id=m.id AND s.space_id=? WHERE m.id=?`)
    .bind(spaceId, machineId).first<MachineAccess>();
  return machinePermission(row, userId, manage);
}

export async function setMachineSharing(db: Db, machineId: string, userId: string, spaceId: string, shared: boolean): Promise<string | null> {
  // 项目绑定与共享修改使用同一事务锁；取得锁后的语句重新读取授权。
  const results = await db.batchReturning([
    routingLock(db),
    machineBindingLock(db, machineId),
    db.prepare(`INSERT INTO space_machines (space_id, machine_id, created_at, shared)
      SELECT ?, id, ?, ? FROM machines WHERE id=? AND owner_user_id=?
      ON CONFLICT (space_id, machine_id) DO UPDATE SET shared=excluded.shared
      RETURNING machine_id`).bind(spaceId, Date.now(), shared ? 1 : 0, machineId, userId),
  ]);
  return results[2].rowCount ? null : "只有机器所有者可以修改共享设置";
}

export function machineBindingLock(db: Db, machineId: string) {
  return db.prepare(`SELECT pg_advisory_xact_lock(hashtextextended(?, 8734019))`).bind(machineId);
}

/** 在授权变更使用的锁内执行，禁止仅依赖请求入口的旧检查结果。 */
export function bindingAccessSql(): string {
  return `EXISTS (SELECT 1 FROM machines m WHERE m.id=? AND (m.owner_user_id=? OR EXISTS (
    SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=? AND sm.shared=1)))`;
}

/** 跨项目串行分配，避免同一台机器被并发判定为空闲。共享与绑定变更采用同一锁顺序。 */
export function routingLock(db: Db) { return db.prepare(`SELECT pg_advisory_xact_lock(8734022)`); }
