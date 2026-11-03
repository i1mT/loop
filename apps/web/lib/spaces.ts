// 空间：同一空间里的成员看到同一套项目、任务、反馈和合并设置；空间之间互不可见。
// 机器不属于某一个空间。一台机器上的守护进程只有一个，项目绑定到这台机器后，它会领取这些项目的任务，不论项目在哪个空间。
import { getDb, newId, now } from "./db.ts";
import type { Db } from "./pg.ts";

export const DEFAULT_SPACE_ID = "space_default";
export const SPACE_HEADER = "x-loop-space";
/** 超级管理员由部署者通过账号脚本显式创建，权限以数据库 role 为准。 */

export interface SpaceRow {
  id: string;
  name: string;
  role: string;
}

const spacesOf = new WeakMap<Request, string>();

export function rememberSpace(req: Request, spaceId: string): void {
  spacesOf.set(req, spaceId);
}

/** 这次请求选定的空间。守护进程请求没有空间。 */
export function requestSpace(req: Request): string | null {
  return spacesOf.get(req) ?? null;
}

function cookie(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

export function requestedSpaceId(req: Request): string | null {
  const h = req.headers.get(SPACE_HEADER)?.trim();
  if (h) return h;
  return cookie(req.headers, "loop_space");
}

export async function isSuperAdmin(db: Db, userId: string): Promise<boolean> {
  const row = await db.prepare(`SELECT role FROM "user" WHERE id=?`).bind(userId).first<{ role: string | null }>();
  return row?.role === "super";
}

export async function listAllSpaces(db: Db): Promise<{ id: string; name: string }[]> {
  return (await db.prepare(`SELECT id, name FROM spaces ORDER BY created_at ASC`).all<{ id: string; name: string }>()).results;
}

export async function listMemberSpaces(db: Db, userId: string): Promise<SpaceRow[]> {
  return (
    await db
      .prepare(
        `SELECT s.id, s.name, m.role FROM space_members m JOIN spaces s ON s.id = m.space_id WHERE m.user_id=? ORDER BY s.created_at ASC`,
      )
      .bind(userId)
      .all<SpaceRow>()
  ).results;
}

export async function spaceExists(db: Db, id: string): Promise<boolean> {
  const row = await db.prepare(`SELECT id FROM spaces WHERE id=?`).bind(id).first<{ id: string }>();
  return !!row;
}

/** 普通成员只能进被分配的空间。超级管理员可以进任何一个空间。云端令牌（本地网关、脚本）可以指定任一已有空间，否则用默认空间。 */
export async function resolveSpaceId(db: Db, requested: string | null, userId: string | null): Promise<string> {
  if (userId) {
    if (await isSuperAdmin(db, userId)) {
      if (requested && (await spaceExists(db, requested))) return requested;
      const first = await db.prepare(`SELECT id FROM spaces ORDER BY created_at ASC LIMIT 1`).first<{ id: string }>();
      return first?.id ?? "space_none";
    }
    const mine = await listMemberSpaces(db, userId);
    if (requested && mine.some((s) => s.id === requested)) return requested;
    return mine[0]?.id ?? "space_none";
  }
  if (requested && (await spaceExists(db, requested))) return requested;
  return DEFAULT_SPACE_ID;
}

export async function createSpace(db: Db, name: string, userId: string): Promise<SpaceRow> {
  const trimmed = name.trim();
  if (!trimmed || trimmed.length > 40) throw new Error("空间名称必填，最长 40 字");
  const id = newId();
  const t = now();
  await db.prepare(`INSERT INTO spaces (id, name, created_at) VALUES (?, ?, ?)`).bind(id, trimmed, t).run();
  await db.prepare(`INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`).bind(id, userId, t).run();
  return { id, name: trimmed, role: "owner" };
}

export async function addMember(db: Db, spaceId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await db.prepare(`SELECT id FROM "user" WHERE lower(email)=lower(?)`).bind(email.trim()).first<{ id: string }>();
  if (!user) return { ok: false, error: "没有这个账号。请先创建账号，再分配空间" };
  await db
    .prepare(`INSERT INTO space_members (space_id, user_id, role, created_at) VALUES (?, ?, 'member', ?) ON CONFLICT (space_id, user_id) DO NOTHING`)
    .bind(spaceId, user.id, now())
    .run();
  return { ok: true };
}

export async function removeMember(db: Db, spaceId: string, email: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await db.prepare(`SELECT id, email FROM "user" WHERE lower(email)=lower(?)`).bind(email.trim()).first<{ id: string; email: string }>();
  if (!user) return { ok: false, error: "没有这个账号" };
  if (await isSuperAdmin(db, user.id)) return { ok: false, error: "不能取消超级管理员自己的访问" };
  const r = await db.prepare(`DELETE FROM space_members WHERE space_id=? AND user_id=?`).bind(spaceId, user.id).run();
  if (r.meta.changes === 0) return { ok: false, error: "这个账号不在当前空间" };
  return { ok: true };
}

export async function listMembers(db: Db, spaceId: string): Promise<{ email: string; name: string; role: string }[]> {
  return (
    await db
      .prepare(
        `SELECT u.email, u.name, m.role FROM space_members m JOIN "user" u ON u.id = m.user_id WHERE m.space_id=? ORDER BY m.created_at ASC`,
      )
      .bind(spaceId)
      .all<{ email: string; name: string; role: string }>()
  ).results;
}

/** 把机器接到空间里，这样这个空间的项目才能绑定它。同一台机器可以同时接在多个空间。 */
export async function linkMachine(db: Db, spaceId: string, machineId: string): Promise<void> {
  await db
    .prepare(`INSERT INTO space_machines (space_id, machine_id, created_at) VALUES (?, ?, ?) ON CONFLICT (space_id, machine_id) DO NOTHING`)
    .bind(spaceId, machineId, now())
    .run();
}

type Kind = "tasks" | "projects" | "machines" | "feedbacks";

/** 路径里的资源不属于当前空间时返回 404。列表接口没有资源 id。 */
export async function foreignResource(db: Db, spaceId: string, pathname: string): Promise<boolean> {
  const m = pathname.match(/^\/api\/(tasks|projects|machines|feedbacks)\/([^/]+)/);
  if (!m) return false;
  const [, kind, id] = m as [string, Kind, string];
  if (id === "new") return false;
  if (kind === "projects") {
    const row = await db.prepare(`SELECT id FROM projects WHERE id=? AND space_id=?`).bind(id, spaceId).first();
    return !row;
  }
  if (kind === "tasks") {
    const row = await db
      .prepare(`SELECT t.id FROM tasks t JOIN projects p ON p.id=t.project_id WHERE t.id=? AND p.space_id=?`)
      .bind(id, spaceId)
      .first();
    return !row;
  }
  if (kind === "feedbacks") {
    const row = await db
      .prepare(`SELECT f.id FROM feedbacks f JOIN projects p ON p.id=f.project_id WHERE f.id=? AND p.space_id=?`)
      .bind(id, spaceId)
      .first();
    return !row;
  }
  const row = await db.prepare(`SELECT machine_id FROM space_machines WHERE space_id=? AND machine_id=?`).bind(spaceId, id).first();
  return !row;
}

export async function loadRequestSpace(req: Request, userId: string | null): Promise<string> {
  const cached = spacesOf.get(req);
  if (cached) return cached;
  const db = await getDb();
  const spaceId = await resolveSpaceId(db, requestedSpaceId(req), userId);
  spacesOf.set(req, spaceId);
  return spaceId;
}
