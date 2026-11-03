import test from "node:test";
import assert from "node:assert/strict";
import { Db } from "../../pg.ts";
import { migrate } from "../../migrations.ts";
import { useDb } from "../../db.ts";
import { saveBatchSettings, submitFeedback, flushPool } from "../../batch.ts";
import { saveBinding, getBindingSecrets, type Binding } from "../bindings.ts";
import { FEISHU_MIGRATIONS } from "../schema.ts";
import { enqueue } from "../jobs/store.ts";
import { processFeishuJobs } from "../jobs/runner.ts";
import { scanStageEvents } from "../jobs/notifications.ts";
import { syncTaskDocument } from "../documents.ts";
import type { MessageEvent } from "../jobs/messages.ts";
const skip = process.env.DATABASE_URL ? false : "没有 DATABASE_URL";
const key = Buffer.alloc(32, 8).toString("base64");
const origin = "https://loop.test";

test(
  "飞书Postgres集成：空间隔离、重复消息、合并订阅、状态事件及重试恢复",
  { skip },
  async () => {
    const db = new Db(process.env.DATABASE_URL!);
    await migrate(db);
    await db.batch(FEISHU_MIGRATIONS.map((sql) => db.prepare(sql)));
    useDb(db);
    const prefix = `feishu-${crypto.randomUUID()}`,
      spaces = [`${prefix}-a`, `${prefix}-b`],
      projects = spaces.map((s) => `${s}-project`),
      user = `${prefix}-user`;
    const bindings: Binding[] = [];
    const sent: { url: string; body: Record<string, unknown> }[] = [];
    let failSend = false;
    const fetchImpl = (async (url, init) => {
      const uri = String(url),
        body = JSON.parse(String(init?.body ?? "{}"));
      if (uri.includes("/auth/"))
        return Response.json({ code: 0, tenant_access_token: "token" });
      if (failSend) throw new Error("test network outage");
      sent.push({ url: uri, body });
      return Response.json({ code: 0, data: { message_id: "om_sent" } });
    }) as typeof fetch;
    try {
      await db
        .prepare('INSERT INTO "user"(id,name,email) VALUES(?,?,?)')
        .bind(user, "测试用户", `${prefix}@example.test`)
        .run();
      for (let i = 0; i < 2; i++) {
        await db.batch([
          db
            .prepare("INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)")
            .bind(spaces[i], spaces[i], Date.now()),
          db
            .prepare(
              "INSERT INTO projects(id,name,repo_path,main_ref,default_agent,machine_id,agent,space_id,created_at) VALUES(?,?,'','main','grok','fixture-machine','grok',?,?)",
            )
            .bind(projects[i], `项目${i}`, spaces[i], Date.now()),
          db
            .prepare(
              "INSERT INTO space_members(space_id,user_id,role,created_at) VALUES(?,?,'owner',?)",
            )
            .bind(spaces[i], user, Date.now()),
        ]);
        await saveBatchSettings(
          db,
          { enabled: false, maxScale: "small", size: 3 },
          spaces[i],
        );
        const binding = await saveBinding(
          db,
          spaces[i],
          {
            appId: `cli_${crypto.randomUUID().replaceAll("-", "")}`,
            appSecret: "secret",
            verificationToken: "token",
            encryptKey: "encrypt",
            tenantKey: "tenant",
            wikiUrl: "https://test.feishu.cn/wiki/parent",
            defaultProjectId: projects[i],
            enabled: true,
          },
          key,
        );
        bindings.push(binding);
      }
      await assert.rejects(
        saveBinding(
          db,
          spaces[0],
          {
            appId: bindings[0].app_id,
            tenantKey: "tenant",
            wikiUrl: "https://test.feishu.cn/wiki/parent",
            defaultProjectId: projects[1],
            enabled: true,
          },
          key,
        ),
        /默认项目/,
      );
      await assert.rejects(
        getBindingSecrets(
          db,
          bindings[0].id,
          Buffer.alloc(32, 9).toString("base64"),
        ),
      );
      await db
        .prepare(
          "INSERT INTO feishu_identities(binding_id,open_id,user_id) VALUES(?,?,?)",
        )
        .bind(bindings[0].id, "open_user", user)
        .run();
      const event: MessageEvent = {
        sender: { sender_type: "user", sender_id: { open_id: "open_user" } },
        message: {
          message_id: "om_duplicate",
          chat_id: "oc_source",
          chat_type: "p2p",
          message_type: "text",
          content: JSON.stringify({ text: "请创建一个任务：修改登录标题" }),
        },
      };
      await Promise.all([
        enqueue(db, bindings[0].id, "inbox", "test-message", event),
        enqueue(db, bindings[0].id, "inbox", "test-message", event),
      ]);
      await processFeishuJobs(db, key, origin, 5, fetchImpl);
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*)::int AS n FROM feedbacks WHERE project_id=?",
            )
            .bind(projects[0])
            .first<{ n: number }>()
        )?.n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*)::int AS n FROM tasks WHERE project_id=?")
            .bind(projects[0])
            .first<{ n: number }>()
        )?.n,
        1,
      );
      assert.equal(
        (
          await db
            .prepare("SELECT count(*)::int AS n FROM tasks WHERE project_id=?")
            .bind(projects[1])
            .first<{ n: number }>()
        )?.n,
        0,
      );
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*)::int AS n FROM feedback_subscriptions WHERE binding_id=?",
            )
            .bind(bindings[0].id)
            .first<{ n: number }>()
        )?.n,
        1,
      );
      const task = (await db
        .prepare("SELECT id FROM tasks WHERE project_id=?")
        .bind(projects[0])
        .first<{ id: string }>())!;
      await db
        .prepare("UPDATE tasks SET stage='running' WHERE id=?")
        .bind(task.id)
        .run();
      await scanStageEvents(db, origin);
      const recorded = (await db
        .prepare(
          "SELECT notification_chat_id,binding_id FROM feishu_stage_events WHERE task_id=? AND stage=?",
        )
        .bind(task.id, "running")
        .first<{ binding_id: string }>())!;
      assert.equal(recorded.binding_id, bindings[0].id);
      failSend = true;
      const failed = await processFeishuJobs(db, key, origin, 1, fetchImpl);
      assert.equal(failed.failed, 1);
      const retry = (await db
        .prepare(
          "SELECT id,state,attempts FROM feishu_jobs WHERE binding_id=? AND state='pending' AND attempts>0 LIMIT 1",
        )
        .bind(bindings[0].id)
        .first<{ id: string; state: string; attempts: number }>())!;
      assert.equal(retry.attempts, 1);
      failSend = false;
      await db
        .prepare("UPDATE feishu_jobs SET next_at=0 WHERE id=?")
        .bind(retry.id)
        .run();
      await processFeishuJobs(db, key, origin, 10, fetchImpl);
      assert.equal(
        (
          await db
            .prepare("SELECT state FROM feishu_jobs WHERE id=?")
            .bind(retry.id)
            .first<{ state: string }>()
        )?.state,
        "done",
      );
      // 旧轮次已经排队的通知也必须在发送前失效。
      await enqueue(db, bindings[0].id, "send", "old-round", {
        chatId: "oc_source",
        text: "旧轮次完成",
        taskId: task.id,
        round: 1,
      });
      await db
        .prepare("UPDATE tasks SET round=2 WHERE id=?")
        .bind(task.id)
        .run();
      await processFeishuJobs(db, key, origin, 20, fetchImpl);
      assert.ok(
        !sent.some((s) => String(s.body.content).includes("旧轮次完成")),
      );
      // 合并后同一个来源会话只产生一条状态投递。
      await saveBatchSettings(
        db,
        { enabled: true, maxScale: "small", size: 3 },
        spaces[0],
      );
      const feedbackIds: string[] = [];
      let merged: string | null = null;
      for (let i = 0; i < 3; i++) {
        const result = await submitFeedback(
          {
            projectId: projects[0],
            title: `小改动${i}`,
            source: "feishu",
            idempotencyKey: `pool-${i}`,
          },
          {
            key: "fake",
            classify: async () => ({
              scale: "tiny",
              confidence: 1,
              suspicious: false,
              source: "model",
            }),
          },
        );
        feedbackIds.push(result.feedback.id);
        if (result.task) merged = result.task.id;
        await db
          .prepare(
            "INSERT INTO feedback_subscriptions(feedback_id,binding_id,chat_id,message_id) VALUES(?,?,?,?)",
          )
          .bind(result.feedback.id, bindings[0].id, "oc_same", `om_pool${i}`)
          .run();
      }
      assert.ok(merged);
      await scanStageEvents(db, origin);
      const eventId = (await db
        .prepare(
          "SELECT id FROM feishu_stage_events WHERE task_id=? AND stage='queued'",
        )
        .bind(merged)
        .first<{ id: number }>())!.id;
      assert.equal(
        (
          await db
            .prepare(
              "SELECT count(*)::int AS n FROM feishu_jobs WHERE dedupe_key LIKE ?",
            )
            .bind(`task:${merged}:event:${eventId}:%`)
            .first<{ n: number }>()
        )?.n,
        1,
      );
    } finally {
      for (let i = 0; i < spaces.length; i++) {
        await db
          .prepare("DELETE FROM feedbacks WHERE project_id=?")
          .bind(projects[i])
          .run();
        await db
          .prepare("DELETE FROM tasks WHERE project_id=?")
          .bind(projects[i])
          .run();
        await db
          .prepare("DELETE FROM space_feishu_bindings WHERE space_id=?")
          .bind(spaces[i])
          .run();
        await db
          .prepare("DELETE FROM projects WHERE id=?")
          .bind(projects[i])
          .run();
        await db
          .prepare("DELETE FROM space_members WHERE space_id=?")
          .bind(spaces[i])
          .run();
        await db.prepare("DELETE FROM spaces WHERE id=?").bind(spaces[i]).run();
        await db
          .prepare("DELETE FROM kv WHERE k LIKE ?")
          .bind(`%:${spaces[i]}`)
          .run();
      }
      await db.prepare('DELETE FROM "user" WHERE id=?').bind(user).run();
    }
  },
);

test(
  "文档创建和正文响应丢失后使用远端节点及分段标记恢复，不重复创建或追加",
  { skip },
  async () => {
    const db = new Db(process.env.DATABASE_URL!);
    await migrate(db);
    useDb(db);
    const id = `document-${crypto.randomUUID()}`;
    let binding: Binding | null = null;
    const remote: {
      node_token: string;
      obj_token: string;
      space_id: string;
      title: string;
      obj_type: string;
    }[] = [];
    let blocks: Record<string, unknown>[] = [];
    let loseCreate = true,
      loseAppend = true,
      creates = 0,
      appends = 0;
    const fetchImpl = (async (url, init) => {
      const uri = String(url),
        body = JSON.parse(String(init?.body ?? "{}"));
      if (uri.includes("/auth/"))
        return Response.json({ code: 0, tenant_access_token: "token" });
      if (uri.includes("/get_node"))
        return Response.json({
          code: 0,
          data: { node: { node_token: "parent", space_id: "wiki_space" } },
        });
      if (uri.includes("/wiki/") && init?.method === "GET")
        return Response.json({
          code: 0,
          data: { items: remote, has_more: false },
        });
      if (uri.includes("/wiki/")) {
        creates++;
        const node = {
          node_token: "child",
          obj_token: "doc",
          space_id: "wiki_space",
          title: body.title,
          obj_type: "docx",
        };
        remote.push(node);
        if (loseCreate) {
          loseCreate = false;
          throw new Error("response lost");
        }
        return Response.json({ code: 0, data: { node } });
      }
      if (init?.method === "GET")
        return Response.json({
          code: 0,
          data: { items: blocks, has_more: false },
        });
      appends++;
      blocks.push(...body.children);
      if (loseAppend) {
        loseAppend = false;
        throw new Error("append response lost");
      }
      return Response.json({
        code: 0,
        data: {
          children: body.children.map((_: unknown, i: number) => ({
            block_id: `b${i}`,
          })),
        },
      });
    }) as typeof fetch;
    try {
      await db.batch([
        db
          .prepare("INSERT INTO spaces(id,name,created_at) VALUES(?,?,?)")
          .bind(id, "文档测试", Date.now()),
        db
          .prepare(
            "INSERT INTO projects(id,name,repo_path,space_id,created_at) VALUES(?,'文档测试','',?,?)",
          )
          .bind(id, id, Date.now()),
      ]);
      binding = await saveBinding(
        db,
        id,
        {
          appId: `cli_${crypto.randomUUID().replaceAll("-", "")}`,
          appSecret: "secret",
          verificationToken: "token",
          encryptKey: "encrypt",
          tenantKey: "tenant",
          wikiUrl: "https://test.feishu.cn/wiki/parent",
          enabled: true,
        },
        key,
      );
      await db
        .prepare(
          "INSERT INTO tasks(id,project_id,title,agent,stage,release_review,plan_review,batch_eligible,created_at,updated_at) VALUES(?,?,'测试','grok','running',1,0,0,?,?)",
        )
        .bind(id, id, Date.now(), Date.now())
        .run();
      await db
        .prepare(
          "INSERT INTO task_plan_rounds(task_id,round,binding_id,wiki_url,updated_at) VALUES(?,1,?,?,?)",
        )
        .bind(id, binding.id, binding.wiki_url, Date.now())
        .run();
      const input = {
        taskId: id,
        round: 1,
        title: "测试",
        markdown: "## 背景\n内容\n- 改动",
        kind: "plan" as const,
      };
      const deps = { db, key, fetchImpl };
      await assert.rejects(syncTaskDocument(input, deps), /response lost/);
      await assert.rejects(
        syncTaskDocument(input, deps),
        /append response lost/,
      );
      assert.equal(creates, 1);
      assert.equal(appends, 1);
      const count = blocks.length;
      assert.equal(
        (await syncTaskDocument(input, deps)).url,
        "https://test.feishu.cn/wiki/child",
      );
      assert.equal(blocks.length, count);
      assert.equal(appends, 1);
      assert.equal(creates, 1);
    } finally {
      await db.prepare("DELETE FROM tasks WHERE id=?").bind(id).run();
      await db
        .prepare("DELETE FROM space_feishu_bindings WHERE space_id=?")
        .bind(id)
        .run();
      await db.prepare("DELETE FROM projects WHERE id=?").bind(id).run();
      await db.prepare("DELETE FROM spaces WHERE id=?").bind(id).run();
    }
  },
);
