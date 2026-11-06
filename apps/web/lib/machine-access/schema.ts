// 旧机器一次性归属现有管理员；保留旧凭证兼容范围，不允许用它登记其他机器。
export const MACHINE_ACCESS_SCHEMA = [
  `ALTER TABLE machines ADD COLUMN IF NOT EXISTS owner_user_id TEXT`,
  `ALTER TABLE machines ADD COLUMN IF NOT EXISTS credential_hash TEXT`,
  `ALTER TABLE machines ADD COLUMN IF NOT EXISTS legacy_auth INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE space_machines ADD COLUMN IF NOT EXISTS shared INTEGER NOT NULL DEFAULT 0`,
  `WITH adopted AS (
    UPDATE machines SET owner_user_id=(SELECT min(id) FROM "user" WHERE role='super' HAVING count(*)=1), legacy_auth=1
    WHERE owner_user_id IS NULL AND credential_hash IS NULL
      AND (SELECT count(*) FROM "user" WHERE role='super')=1 RETURNING id
  ) UPDATE space_machines SET shared=1 WHERE machine_id IN (SELECT id FROM adopted)`,
  `CREATE INDEX IF NOT EXISTS machines_owner_idx ON machines(owner_user_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS machines_credential_idx ON machines(credential_hash) WHERE credential_hash IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS machine_pairings (
    code_hash TEXT PRIMARY KEY, owner_user_id TEXT NOT NULL, space_id TEXT NOT NULL,
    expires_at BIGINT NOT NULL, machine_id TEXT NOT NULL UNIQUE, name TEXT NOT NULL, consumed_at BIGINT)`,
  `CREATE INDEX IF NOT EXISTS machine_pairings_expiry_idx ON machine_pairings(expires_at)`,
];
