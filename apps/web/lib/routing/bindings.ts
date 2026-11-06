import type { Db, Statement } from "../pg.ts";
import { canUseMachine, bindingAccessSql } from "../machine-access/policy.ts";
import { validateBinding, validateModelEffort } from "../machines.ts";

/** 项目绑定的一台机器。智能体、模型与思考程度都可以逐台配置；model/effort 为空表示跟随机器上该智能体的默认配置。 */
export interface ProjectBinding {
  machineId: string;
  localPath: string | null;
  agent: string;
  model?: string | null;
  effort?: string | null;
}

export async function readBindings(db: Db, projectId: string, userId?: string | null): Promise<ProjectBinding[]> {
  return (await db.prepare(`SELECT b.machine_id AS "machineId",b.local_path AS "localPath",b.agent,b.model,b.effort FROM project_machines b
    JOIN projects p ON p.id=b.project_id JOIN machines m ON m.id=b.machine_id
    WHERE b.project_id=? ${userId !== undefined ? `AND (m.owner_user_id=? OR EXISTS(SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=p.space_id AND sm.shared=1))` : ""}
    ORDER BY b.position,b.machine_id`).bind(projectId,...(userId !== undefined ? [userId] : [])).all<ProjectBinding>()).results;
}

export async function prepareBindings(db: Db, requested: ProjectBinding[], fallbackAgent: string, spaceId: string, actorId?: string | null, previous: ProjectBinding[] = []): Promise<ProjectBinding[]> {
  if(!Array.isArray(requested)||!requested.length)throw new Error("请至少选择一台机器");
  const seen=new Set<string>();
  const rows:ProjectBinding[]=[];
  for(const row of requested){
    if(!row||typeof row.machineId!=="string"||seen.has(row.machineId))throw new Error("机器不能重复，且需要合法的机器编号");
    if(row.localPath!=null&&typeof row.localPath!=="string")throw new Error("仓库目录格式无效");
    if(row.model!=null&&typeof row.model!=="string")throw new Error("模型格式无效");
    if(row.effort!=null&&typeof row.effort!=="string")throw new Error("思考程度格式无效");
    if(actorId!==undefined&&!await canUseMachine(db,row.machineId,actorId,spaceId))throw new Error("没有这台机器的使用权限");
    const agent=(row.agent||fallbackAgent||"").trim();
    if(!agent)throw new Error("请为每台机器选择智能体");
    const model=row.model?.trim()||null;
    const effort=row.effort?.trim()||null;
    const error=(await validateBinding(db,row.machineId,agent))??(await validateModelEffort(db,row.machineId,agent,model,effort));
    if(error)throw new Error(error);
    seen.add(row.machineId);
    rows.push({machineId:row.machineId,localPath:row.localPath?.trim()||null,agent,model,effort});
  }
  // 不可见的私有绑定由其所有者管理，其他成员编辑项目时必须保留（连同它的智能体与模型配置）。
  for(const row of previous)if(!seen.has(row.machineId)&&actorId!==undefined&&!await canUseMachine(db,row.machineId,actorId,spaceId)){rows.push(row);seen.add(row.machineId);}
  return rows;
}

export function bindingWrites(db: Db, projectId: string, rows: ProjectBinding[]): Statement[] {
  return [db.prepare(`DELETE FROM project_machines WHERE project_id=?`).bind(projectId),...rows.map((row,position)=>db.prepare(`INSERT INTO project_machines(project_id,machine_id,position,local_path,agent,model,effort) VALUES(?,?,?,?,?,?,?)`).bind(projectId,row.machineId,position,row.localPath,row.agent,row.model??null,row.effort??null))];
}

export function bindingAuthorization(db: Db, rows: ProjectBinding[], spaceId: string, actorId?: string | null): Statement[] {
  return actorId===undefined?[]:[db.prepare(`SELECT 1/CASE WHEN ${rows.map(()=>bindingAccessSql()).join(" AND ")} THEN 1 ELSE 0 END`).bind(...rows.flatMap(row=>[row.machineId,actorId,spaceId]))];
}
