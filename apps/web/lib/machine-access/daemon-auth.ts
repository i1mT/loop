import { canonicalPath } from "./path.ts";
import type { Db } from "../pg.ts";
import { credentialMachine } from "./credentials.ts";

/** 每条 daemon 路由都绑定机器身份，包括没有 daemonId 的 inbox 与 session 查询。 */
export async function authenticateDaemon(db: Db, req: Request, token: string, legacyToken: string): Promise<boolean> {
  const url = new URL(req.url);
  const pathname=canonicalPath(req);if(pathname===null)return false;
  const body = req.method === "GET" ? null : await req.clone().json().catch(() => null) as Record<string, unknown> | null;
  const identities = [body?.machineId, body?.daemonId, url.searchParams.get("daemonId")].filter(value => value != null);
  const supplied = identities[0];
  let resourceMachine: string | null = null;
  const match = pathname.match(/^\/api\/daemon\/(leases|sessions|inbox|tasks)\/([^/]+)/);
  if (match) {
    const [, kind, id] = match;
    const query = kind === "leases" ? `SELECT daemon_id AS id FROM leases WHERE id=?`
      : kind === "sessions" ? `SELECT t.machine_id AS id FROM sessions s JOIN tasks t ON t.id=s.task_id WHERE s.id=?`
      : kind === "inbox" ? `SELECT t.machine_id AS id FROM inbox i JOIN sessions s ON s.id=i.session_id JOIN tasks t ON t.id=s.task_id WHERE i.id=?`
      : `SELECT machine_id AS id FROM tasks WHERE id=?`;
    resourceMachine = (await db.prepare(query).bind(decodeURIComponent(id)).first<{ id: string }>())?.id ?? null;
    // 第一次事件会创建 session；此时用租约确定机器，已存在的 session 必须以数据库归属为准。
    if (!resourceMachine && kind === "sessions" && typeof body?.leaseId === "string") {
      resourceMachine = (await db.prepare(`SELECT daemon_id AS id FROM leases WHERE id=?`).bind(body.leaseId).first<{ id: string }>())?.id ?? null;
    }
    if (!resourceMachine) return false;
  }
  const identity = await credentialMachine(db, token);
  const expected = resourceMachine ?? (typeof supplied === "string" ? supplied : null);
  if (!expected || identities.some(value => value !== expected)) return false;
  if (identity) return identity === expected;
  if (!legacyToken || token !== legacyToken) return false;
  return !!(await db.prepare(`SELECT id FROM machines WHERE id=? AND legacy_auth=1 AND credential_hash IS NULL`).bind(expected).first());
}
