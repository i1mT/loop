import { machineBindingLock } from "./policy.ts";
import type { Db } from "../pg.ts";

export async function hashCredential(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");
}

export function randomSecret(prefix: string): string {
  return prefix + Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function credentialMachine(db: Db, token: string): Promise<string | null> {
  if (!/^lm_[0-9a-f]{64}$/.test(token)) return null;
  const row = await db.prepare(`SELECT id FROM machines WHERE credential_hash=?`).bind(await hashCredential(token)).first<{ id: string }>();
  return row?.id ?? null;
}

export async function createPairing(db: Db, ownerId: string, spaceId: string, name: string, reconnectId?: string) {
  const code = randomSecret("lc_");
  const machineId = reconnectId ?? `m-${crypto.randomUUID()}`;
  if (reconnectId) await db.prepare(`DELETE FROM machine_pairings WHERE machine_id=? AND owner_user_id=?`).bind(reconnectId, ownerId).run();
  const expiresAt = Date.now() + 10 * 60_000;
  await db.prepare(`DELETE FROM machine_pairings WHERE expires_at<?`).bind(Date.now() - 86_400_000).run();
  await db.prepare(`INSERT INTO machine_pairings (code_hash, owner_user_id, space_id, expires_at, machine_id, name) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(await hashCredential(code), ownerId, spaceId, expiresAt, machineId, name.trim().slice(0, 80) || "我的电脑").run();
  return { code, machineId, expiresAt };
}

/** DELETE RETURNING 与机器登记在同一个语句中完成，并发兑换只有一个成功。 */
export async function redeemPairing(db: Db, code: string) {
  if (!/^lc_[0-9a-f]{64}$/.test(code)) return null;
  const codeHash=await hashCredential(code);
  const pairing=await db.prepare(`SELECT machine_id FROM machine_pairings WHERE code_hash=?`).bind(codeHash).first<{machine_id:string}>();
  if (!pairing) return null;
  const token = randomSecret("lm_");
  const result = await db.batchReturning([machineBindingLock(db,pairing.machine_id),db.prepare(`WITH pairing AS (
      DELETE FROM machine_pairings WHERE code_hash=? AND expires_at>? AND EXISTS (
        SELECT 1 FROM space_members WHERE user_id=machine_pairings.owner_user_id AND space_id=machine_pairings.space_id
        UNION ALL SELECT 1 FROM "user" WHERE id=machine_pairings.owner_user_id AND role='super'
      ) RETURNING *
    ), machine AS (
      INSERT INTO machines (id, name, owner_user_id, credential_hash, legacy_auth, last_seen, created_at)
      SELECT machine_id, name, owner_user_id, ?, 0, 0, ? FROM pairing
      ON CONFLICT (id) DO UPDATE SET credential_hash=excluded.credential_hash, legacy_auth=0
        WHERE machines.owner_user_id=excluded.owner_user_id RETURNING id
    ), linked AS (
      INSERT INTO space_machines (space_id, machine_id, created_at, shared)
      SELECT space_id, machine_id, ?, 0 FROM pairing
      ON CONFLICT (space_id,machine_id) DO UPDATE SET created_at=space_machines.created_at RETURNING machine_id
    ) SELECT machine.id FROM machine JOIN linked ON linked.machine_id=machine.id`)
    .bind(codeHash, Date.now(), await hashCredential(token), Date.now(), Date.now())]);
  const row=result[1].rows[0];
  return row ? { machineId: String(row.id), token } : null;
}

/** 断开同时撤销尚未兑换的重连码；与兑换使用同一把事务锁。 */
export async function revokeMachineCredential(db: Db, machineId: string, userId: string): Promise<void> {
  await db.batch([
    machineBindingLock(db,machineId),
    db.prepare(`DELETE FROM machine_pairings WHERE machine_id=? AND owner_user_id=?`).bind(machineId,userId),
    db.prepare(`UPDATE machines SET credential_hash=NULL, legacy_auth=0, last_seen=0 WHERE id=? AND owner_user_id=?`).bind(machineId,userId),
  ]);
}
