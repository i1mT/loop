import type { Db, Statement } from "../../pg.ts";

/** 备注只在当前事务生效，由阶段触发器保存快照，不会进入连接池的下一次请求。 */
export function notificationContext(db: Db, taskId: string, detail: string): Statement {
  return db.prepare(`SELECT set_config('loop.feishu_notification',?,true)`)
    .bind(JSON.stringify({taskId,detail:detail.trim()}));
}

export async function stageChange(db: Db, statement: Statement, taskId: string, detail: string) {
  const results=await db.batchReturning([notificationContext(db,taskId,detail),statement]);
  return results[1];
}
