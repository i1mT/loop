import { requestUserId } from "@/lib/machine-access/request.ts";
import { requestOrigin } from "@/lib/public-url.ts";
import { canUseMachine } from "@/lib/machine-access/policy.ts";
import { fail, json, readJson, requireRole } from "@/lib/http.ts";
import { getDb } from "@/lib/db.ts";
import { sessionUser } from "@/lib/auth-server.ts";
import { getEnv } from "@/lib/env.ts";
import { addMember, createSpace, isSuperAdmin, linkMachine, listAllSpaces, listMemberSpaces, listMembers, removeMember, requestSpace } from "@/lib/spaces.ts";
import { listMachines } from "@/lib/machines.ts";

async function actorId(req: Request): Promise<string | null> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return (await sessionUser(req.headers, requestOrigin(req.headers, req.headers.get("host") ?? new URL(req.url).host)))?.id ?? null;
  if (token !== getEnv().LOOP_ADMIN_TOKEN) return null;
  const email = req.headers.get("x-loop-user")?.trim().toLowerCase();
  if (!email) return null;
  const row = await (await getDb()).prepare(`SELECT id FROM "user" WHERE lower(email)=?`).bind(email).first<{ id: string }>();
  return row?.id ?? null;
}

export async function GET(req: Request) {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const db = await getDb();
  const userId = await actorId(req);
  const superAdmin = userId ? await isSuperAdmin(db, userId) : false;
  const spaces = superAdmin ? (await listAllSpaces(db)).map((s) => ({ ...s, role: "super" })) : userId ? await listMemberSpaces(db, userId) : [];
  const current = requestSpace(req);
  const inSpace = superAdmin || spaces.some((s) => s.id === current) || !userId;
  const members = current && inSpace ? await listMembers(db, current) : [];
  const machines = current && inSpace ? await listMachines(db, current, requestUserId(req)) : [];
  const available = superAdmin && current && current !== "space_none"
    ? (await listMachines(db, current, requestUserId(req))).filter((m) => !machines.some((x) => x.id === m.id)).map((m) => ({ id: m.id, name: m.name, online: m.online }))
    : [];
  return json({ ok: true, spaces, current, members, available, super: superAdmin });
}

async function requireSuper(req: Request): Promise<{ db: Awaited<ReturnType<typeof getDb>>; userId: string } | Response> {
  const denied = await requireRole(req, "admin");
  if (denied) return denied;
  const userId = await actorId(req);
  if (!userId) return fail(403, "只有超级管理员可以做这件事");
  const db = await getDb();
  if (!(await isSuperAdmin(db, userId))) return fail(403, "只有超级管理员可以创建空间、创建账号和修改空间权限");
  return { db, userId };
}

export async function POST(req: Request) {
  const gate = await requireSuper(req);
  if (gate instanceof Response) return gate;
  const body = await readJson<{ name?: string }>(req);
  try {
    const space = await createSpace(gate.db, body?.name ?? "", gate.userId);
    return json({ ok: true, space }, 201);
  } catch (e) {
    return fail(400, (e as Error).message);
  }
}

export async function PUT(req: Request) {
  const gate = await requireSuper(req);
  if (gate instanceof Response) return gate;
  const db = gate.db;
  const body = await readJson<{ email?: string; machineId?: string; remove?: boolean }>(req);
  const spaceId = requestSpace(req);
  if (!spaceId || spaceId === "space_none") return fail(400, "没有当前空间");
  if (body?.email) {
    const r = body.remove ? await removeMember(db, spaceId, body.email) : await addMember(db, spaceId, body.email);
    return r.ok ? json({ ok: true }) : fail(400, r.error);
  }
  if (body?.machineId) {
    const m = await canUseMachine(db, body.machineId, gate.userId, spaceId, true);
    if (!m) return fail(404, "机器不存在");
    await linkMachine(db, spaceId, body.machineId);
    return json({ ok: true });
  }
  return fail(400, "需要 email 或 machineId");
}
