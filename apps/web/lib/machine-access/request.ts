import { canonicalPath } from "./path.ts";
import { canUseProject, canManageProject } from "../routing/access.ts";
import type { Db } from "../pg.ts";
import { canUseMachine } from "./policy.ts";

const actors = new WeakMap<Request, string | null>();
export const requestUserId = (req: Request): string | null => actors.get(req) ?? null;
export const rememberUser = (req: Request, userId: string | null): void => { actors.set(req, userId); };

export async function machineRequestAllowed(db: Db, req: Request, userId: string | null, spaceId: string): Promise<boolean> {
  const pathname=canonicalPath(req);
  if(pathname===null)return false;
  const match = pathname.match(/^\/api\/(machines|tasks|projects|feedbacks)\/([^/]+)/);
  if (match && !(match[1] === "machines" && ["connect", "pairings"].includes(match[2])) && match[2] !== "new") {
    const [, kind, id] = match;
    if (kind === "machines") return canUseMachine(db, decodeURIComponent(id), userId, spaceId, req.method !== "GET");
    if(kind === "projects") {
      if(!await canUseProject(db,decodeURIComponent(id),userId,spaceId))return false;
      if(/^\/api\/projects\/[^/]+\/(sdk|api-keys|archive)(?:\/|$)/.test(pathname)&&!await canManageProject(db,decodeURIComponent(id),userId,spaceId))return false;
    }
    else if(kind === "feedbacks") {const row=await db.prepare(`SELECT project_id FROM feedbacks WHERE id=?`).bind(decodeURIComponent(id)).first<{project_id:string}>();if(row&&!await canUseProject(db,row.project_id,userId,spaceId))return false;}
    else {
      const query = kind === "projects" ? `SELECT machine_id FROM projects WHERE id=?`
        : kind === "tasks" ? `SELECT machine_id FROM tasks WHERE id=?`
        : `SELECT p.machine_id FROM feedbacks f JOIN projects p ON p.id=f.project_id WHERE f.id=?`;
      const row = await db.prepare(query).bind(decodeURIComponent(id)).first<{ machine_id: string | null }>();
      if (row?.machine_id && !await canUseMachine(db, row.machine_id, userId, spaceId)) return false;
    }
  }
  if (["POST", "PATCH", "PUT"].includes(req.method) && /^\/api\/(tasks|projects|feishu)(?:\/|$)/.test(pathname)) {
    const body = await req.clone().json().catch(() => null) as { machineId?: unknown; bindings?: {machineId?:unknown}[]; projectId?: unknown; defaultProjectId?: unknown } | null;
    if (body?.machineId != null && (typeof body.machineId !== "string" || !await canUseMachine(db, body.machineId, userId, spaceId))) return false;
    if(body?.bindings!==undefined){
      if(!Array.isArray(body.bindings))return false;
      for(const binding of body.bindings)if(typeof binding?.machineId!=="string"||!await canUseMachine(db,binding.machineId,userId,spaceId))return false;
    }
    for (const projectId of [body?.projectId, body?.defaultProjectId]) {
      if (typeof projectId !== "string" || !projectId) continue;
      if(!await (pathname.startsWith("/api/feishu/")?canManageProject:canUseProject)(db,projectId,userId,spaceId))return false;
    }
  }
  return true;
}
