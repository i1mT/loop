import type { Db } from "../pg.ts";
import { ONLINE_MS } from "../machines.ts";

export interface DispatchInput {
  id: string; projectId: string; title: string; body: string; agent?: string;
  source: string | null; sourceRef: string | null;
  releaseReview: number; planReview: number; batchEligible: number; previewSlot: string | null;
  priority: string; at: number; actorId?: string | null;
  claim?: {token: string; count: number};
}

/**
 * 候选机器：每条绑定用自己的智能体；模型与思考程度优先用绑定上的覆盖，为空时跟随机器上该智能体的默认配置。
 * 任务创建时显式指定智能体（输入 ?）会覆盖绑定，只保留那台机器上安装了该智能体的绑定。
 * 绑定上的模型/思考程度只对同一个智能体有意义，覆盖智能体时退回机器默认。
 */
function candidates() {
  return `SELECT b.machine_id,b.position,b.local_path,COALESCE(?,b.agent,p.agent) AS agent,
    CASE WHEN b.agent=COALESCE(?,b.agent,p.agent) THEN COALESCE(b.model,a.default_model) ELSE a.default_model END AS default_model,
    CASE WHEN b.agent=COALESCE(?,b.agent,p.agent) THEN COALESCE(b.effort,a.default_effort) ELSE a.default_effort END AS default_effort,
    p.dispatch_cursor,
    m.last_seen>=? AS online,
    EXISTS(SELECT 1 FROM tasks busy WHERE busy.machine_id=m.id AND (
      busy.stage IN ('queued','approved','publishing','needs_you') OR
      (busy.stage='running' AND NOT EXISTS(SELECT 1 FROM task_plan_rounds r WHERE r.task_id=busy.id AND r.round=busy.round AND r.phase IN ('awaiting_review','syncing'))))) AS busy
    FROM projects p JOIN project_machines b ON b.project_id=p.id JOIN machines m ON m.id=b.machine_id
    JOIN machine_agents a ON a.machine_id=m.id AND a.kind=COALESCE(?,b.agent,p.agent)
    WHERE p.id=? AND p.archived_at IS NULL AND a.installed=1 AND a.acp=1`;
}
export function dispatchInsert(db: Db, input: DispatchInput) {
  const access=input.actorId!==undefined?` AND (m.owner_user_id=? OR EXISTS(SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=p.space_id AND sm.shared=1))`:"";
  return db.prepare(`WITH candidates AS (${candidates()}${access}), selected AS (
      SELECT * FROM candidates ORDER BY CASE WHEN online AND NOT busy THEN 0 WHEN online THEN 1 ELSE 2 END,
      CASE WHEN position>=dispatch_cursor THEN 0 ELSE 1 END,position LIMIT 1
    ), inserted AS (
      INSERT INTO tasks(id,project_id,title,body,agent,model,effort,source,source_ref,machine_id,stage,release_review,plan_review,batch_eligible,preview_slot,priority,created_at,updated_at,execution_path,execution_snapshot)
      SELECT ?,?,?,?,s.agent,s.default_model,s.default_effort,?,?,s.machine_id,'queued',?,?,?,?,?,?,?,s.local_path,1 FROM selected s
      ${input.claim?`WHERE (SELECT COUNT(*) FROM feedbacks WHERE task_id=?)=?`:""}
      ON CONFLICT(id) DO NOTHING RETURNING id
    ) UPDATE projects SET dispatch_cursor=(SELECT position+1 FROM selected)
      WHERE id=? AND EXISTS(SELECT 1 FROM inserted) RETURNING id`)
    .bind(input.agent??null,input.agent??null,input.agent??null,input.at-ONLINE_MS,input.agent??null,input.projectId,...(input.actorId!==undefined?[input.actorId]:[]),
      input.id,input.projectId,input.title,input.body,input.source,input.sourceRef,input.releaseReview,input.planReview,input.batchEligible,input.previewSlot,input.priority,input.at,input.at,
      ...(input.claim?[input.claim.token,input.claim.count]:[]),input.projectId);
}

/** 在调度锁内复核；没有匹配项时回滚整个反馈/方案创建事务。 */
export function dispatchAuthorization(db: Db, projectId: string, agent?: string, actorId?: string | null) {
  return db.prepare(`SELECT 1/CASE WHEN EXISTS(${candidates()}${actorId!==undefined?` AND (m.owner_user_id=? OR EXISTS(SELECT 1 FROM space_machines sm WHERE sm.machine_id=m.id AND sm.space_id=p.space_id AND sm.shared=1))`:""}) THEN 1 ELSE 0 END`)
    .bind(agent??null,agent??null,agent??null,Date.now()-ONLINE_MS,agent??null,projectId,...(actorId!==undefined?[actorId]:[]));
}
