import { test } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { useDb } from "./db.ts";
import { claim } from "./daemon-api.ts";
import { migrate } from "./migrations.ts";
import {
  acceptTechnicalPlan,
  approveTechnicalPlan,
  getTechnicalPlan,
  taskPlanInitialization,
} from "./task-plan/service.ts";
const skip = process.env.DATABASE_URL ? false : "没有 DATABASE_URL";
const markdown = [
  "背景",
  "目标",
  "技术实现",
  "改动点",
  "验证方式",
  "风险与回滚",
]
  .map((s) => `## ${s}\n这里记录需求与实现的具体信息，保证方案能够完整复查。`)
  .join("\n");
test(
  "技术方案持久门禁：重复上传、跨轮次、过期租约与审核版本",
  { skip },
  async () => {
    const db = new Db(process.env.DATABASE_URL!);
    await migrate(db);
    const id = `plan-${crypto.randomUUID()}`;
    const at = Date.now();
    try {
      await db.batch([
        db
          .prepare(`INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)`)
          .bind(id, "方案测试", at),
        db
          .prepare(
            `INSERT INTO projects(id,name,repo_path,main_ref,default_agent,space_id,created_at) VALUES(?,?,'','main','grok',?,?)`,
          )
          .bind(id, "方案测试", id, at),
        db
          .prepare(
            `INSERT INTO space_feishu_bindings(id,space_id,app_id,tenant_key,secrets,wiki_url,enabled,created_at,updated_at) VALUES(?,?,?,'tenant','{}','https://test.feishu.cn/wiki/parent',1,?,?)`,
          )
          .bind(id, id, id, at, at),
        db
          .prepare(
            `INSERT INTO tasks(id,project_id,title,body,agent,stage,release_review,plan_review,batch_eligible,created_at,updated_at) VALUES(?,?,'测试','测试','grok','running',1,1,0,?,?)`,
          )
          .bind(id, id, at, at),
        taskPlanInitialization(db, id, id, 1),
        db
          .prepare(
            `INSERT INTO leases(id,task_id,daemon_id,expires_at) VALUES(?,?,?,?)`,
          )
          .bind(id, id, id, at + 60000),
      ]);
      useDb(db);
      await db
        .prepare(`UPDATE tasks SET machine_id=? WHERE id=?`)
        .bind(id, id)
        .run();
      assert.equal(
        await claim(id),
        null,
        "旧版守护进程不能领取需要技术方案的任务",
      );
      assert.equal(
        (await claim(id, [], true))?.task.technicalPlan && true,
        true,
      );
      assert.equal((await getTechnicalPlan(db, id))?.phase, "analyzing");
      const input = {
        taskId: id,
        round: 1,
        daemonId: id,
        leaseId: id,
        markdown,
        baselineHead: "a".repeat(40),
      };
      await acceptTechnicalPlan(db, input);
      await acceptTechnicalPlan(db, input);
      assert.equal((await getTechnicalPlan(db, id))?.phase, "syncing");
      assert.equal(
        (
          await db
            .prepare(
              `SELECT COUNT(*)::int AS n FROM task_plans WHERE task_id=?`,
            )
            .bind(id)
            .first<{ n: number }>()
        )?.n,
        1,
      );
      await assert.rejects(() =>
        acceptTechnicalPlan(db, { ...input, round: 2 }),
      );
      assert.equal(
        await approveTechnicalPlan(db, id),
        false,
        "同步未成功时不能审核",
      );
      await db.batch([
        db
          .prepare(
            `UPDATE task_plan_rounds SET phase='awaiting_review',document_url='https://test.feishu.cn/wiki/child' WHERE task_id=?`,
          )
          .bind(id),
        db
          .prepare(`UPDATE tasks SET stage='plan_reviewing' WHERE id=?`)
          .bind(id),
      ]);
      assert.equal(
        await approveTechnicalPlan(db, id, 2),
        false,
        "不能批准其他版本",
      );
      assert.equal(await approveTechnicalPlan(db, id, 1), true);
      assert.equal(
        (await getTechnicalPlan(db, id))?.continuationId,
        `${id}:1:1`,
      );
      await db
        .prepare(`UPDATE leases SET expires_at=0 WHERE id=?`)
        .bind(id)
        .run();
      await assert.rejects(() => acceptTechnicalPlan(db, input));
    } finally {
      await db.batch([
        db.prepare(`DELETE FROM leases WHERE task_id=?`).bind(id),
        db.prepare(`DELETE FROM tasks WHERE id=?`).bind(id),
        db.prepare(`DELETE FROM space_feishu_bindings WHERE id=?`).bind(id),
        db.prepare(`DELETE FROM projects WHERE id=?`).bind(id),
        db.prepare(`DELETE FROM spaces WHERE id=?`).bind(id),
      ]);
    }
  },
);
