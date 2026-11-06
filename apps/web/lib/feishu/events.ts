import type { Db } from "../pg.ts";
import type { Binding } from "./bindings.ts";
import type { EventEnvelope } from "./crypto.ts";

/** 只在调用方完成验签、解密和 token 校验后调用；自建应用的首次消息建立企业归属。 */
export async function pinEventTenant(
  db: Db,
  binding: Binding,
  envelope: EventEnvelope,
): Promise<boolean> {
  const header = envelope.header;
  if (
    header?.app_id !== binding.app_id ||
    !header.tenant_key ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(header.tenant_key)
  )
    return false;
  const sender = (
    envelope.event as { sender?: { tenant_key?: string } } | undefined
  )?.sender;
  if (sender?.tenant_key && sender.tenant_key !== header.tenant_key)
    return false;
  if (binding.tenant_verified_at) return binding.tenant_key === header.tenant_key;
  const row = await db
    .prepare(
      `UPDATE space_feishu_bindings SET tenant_key=?,tenant_verified_at=? WHERE id=? AND tenant_verified_at IS NULL RETURNING tenant_key`,
    )
    .bind(header.tenant_key, Date.now(), binding.id)
    .first<{ tenant_key: string }>();
  if (row) return row.tenant_key === header.tenant_key;
  const existing = await db
    .prepare(`SELECT tenant_key FROM space_feishu_bindings WHERE id=?`)
    .bind(binding.id)
    .first<{ tenant_key: string }>();
  return existing?.tenant_key === header.tenant_key;
}
