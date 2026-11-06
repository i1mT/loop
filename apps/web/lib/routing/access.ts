import type { Db } from "../pg.ts";

/** 别名只由源码提供，用户值始终使用占位符。 */
export function projectAccessSql(alias = "projects"): string {
  return `EXISTS (SELECT 1 FROM project_machines pb JOIN machines m ON m.id=pb.machine_id
    WHERE pb.project_id=${alias}.id AND (m.owner_user_id=? OR EXISTS (
      SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=${alias}.space_id AND sm.shared=1)))`;
}
export async function canUseProject(db: Db, projectId: string, userId: string | null, spaceId: string): Promise<boolean> {
  if(!userId)return false;
  return !!await db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND p.space_id=? AND ${projectAccessSql("p")}`).bind(projectId,spaceId,userId).first();
}

/** 项目集成和公共指令会影响整个机器池，必须拥有全部绑定机器的使用权限。 */
export function projectManageSql(alias="projects"):string {
  return `EXISTS(SELECT 1 FROM project_machines existing WHERE existing.project_id=${alias}.id)
    AND NOT EXISTS(SELECT 1 FROM project_machines pb LEFT JOIN machines m ON m.id=pb.machine_id
      WHERE pb.project_id=${alias}.id AND NOT(m.id IS NOT NULL AND (COALESCE(m.owner_user_id=?,false) OR EXISTS(
        SELECT 1 FROM space_machines sm WHERE sm.machine_id=pb.machine_id AND sm.space_id=${alias}.space_id AND sm.shared=1))))`;
}
export async function canManageProject(db:Db,projectId:string,userId:string|null,spaceId:string):Promise<boolean>{
  if(!userId)return false;
  return !!await db.prepare(`SELECT p.id FROM projects p WHERE p.id=? AND p.space_id=? AND ${projectManageSql("p")}`).bind(projectId,spaceId,userId).first();
}
