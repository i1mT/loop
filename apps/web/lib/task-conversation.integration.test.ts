import { test } from "node:test";
import assert from "node:assert/strict";
import { claim, completePublish, ingestEvents, undeliveredInbox } from "./daemon-api.ts";
import { useDb } from "./db.ts";
import { hello } from "./machines.ts";
import { migrate } from "./migrations.ts";
import { Db } from "./pg.ts";
import { pendingConversation, rewindTask, sendTaskReply } from "./task-conversation.ts";
import { createProject, createTask, getTask } from "./tasks.ts";

const dbUrl = process.env.DATABASE_URL;

async function fixture() {
  const db = new Db(dbUrl!);
  await migrate(db);
  useDb(db);
  const machine = crypto.randomUUID();
  await hello(db, { machineId: machine, agents: [{ kind: "grok", installed: true, version: "test", acp: true, note: null }] });
  const project = await createProject({ name: "会话测试", githubRepo: "example/demo", machineId: machine, agent: "grok" });
  const task = await createTask({ projectId: project.id, title: "测试任务" });
  return { db, machine, task, sid: crypto.randomUUID() };
}

test("会话创建前可发消息，领取后原任务的会话可以取走", { skip: !dbUrl }, async () => {
  const { machine, task, sid } = await fixture();
  assert.equal((await sendTaskReply(task.id, "部署脚本也要加测试")).ok, true);
  assert.equal((await pendingConversation(task.id, null))[0].body, "部署脚本也要加测试");
  const lease = (await claim(machine))!;
  assert.equal(lease.task.id, task.id);
  assert.equal((await ingestEvents(sid, lease.leaseId, machine, [])).ok, true);
  assert.equal((await undeliveredInbox(sid, 0, "work"))[0].body, "部署脚本也要加测试");
});

test("发布失败可直接在原会话继续开发，上一轮 PR 与旧租约不参与新轮次", { skip: !dbUrl }, async () => {
  const { db, machine, task, sid } = await fixture();
  const original = (await claim(machine))!;
  await ingestEvents(sid, original.leaseId, machine, []);
  await db.prepare(`UPDATE tasks SET stage='failed',merge_sha='1234567',approved_sha='abcdef0',pr_number=16,pr_url='https://example.com/pr/16' WHERE id=?`).bind(task.id).run();
  assert.deepEqual(await sendTaskReply(task.id, "请修复构建错误"), { ok: true, deferred: false, round: 2 });
  const next = (await claim(machine))!;
  assert.equal(next.task.sessionId, sid);
  assert.equal(next.task.round, 2);
  assert.equal(next.task.prNumber, null);
  assert.notEqual(next.leaseId, original.leaseId);
  assert.equal((await ingestEvents(sid, original.leaseId, machine, [])).ok, false);
  assert.equal((await undeliveredInbox(sid, 0, "work"))[0].body, "请修复构建错误");
});

test("发布中可请求退回审核，发布结束后保留已合并的 PR", { skip: !dbUrl }, async () => {
  const { db, machine, task, sid } = await fixture();
  const work = (await claim(machine))!;
  await ingestEvents(sid, work.leaseId, machine, []);
  await db.prepare(`UPDATE tasks SET stage='approved',head_sha='abcdef0',approved_sha='abcdef0',merge_sha='1234567',pr_number=16 WHERE id=?`).bind(task.id).run();
  const publish = (await claim(machine, [task.id]))!;
  assert.equal(publish.task.job, "publish");
  assert.deepEqual(await Promise.all([rewindTask(task.id, "reviewing"), rewindTask(task.id, "reviewing")]), [{ ok: true, deferred: true }, { ok: true, deferred: true }]);
  assert.equal((await pendingConversation(task.id, sid)).length, 1);
  assert.equal((await getTask(task.id))?.stage, "publishing");
  assert.deepEqual(await undeliveredInbox(sid, 0, "publish"), []);
  assert.equal((await completePublish(publish.leaseId, machine, "failed", "发布失败")).ok, true);
  await claim(machine);
  const rewound = (await getTask(task.id))!;
  assert.deepEqual([rewound.stage, rewound.round, rewound.approved_sha, rewound.merge_sha, rewound.pr_number], ["reviewing", 1, null, "1234567", 16]);
  assert.deepEqual(await rewindTask(task.id, "development"), { ok: true, deferred: false });
  assert.equal((await getTask(task.id))?.stage, "needs_you");
  assert.equal(await claim(machine), null, "回退后等待用户发消息");
  await sendTaskReply(task.id, "先修复本轮问题");
  const next = (await claim(machine))!;
  assert.equal(next.task.sessionId, sid);
  assert.equal(next.task.round, 2);
  assert.equal(next.task.job, "work");
});

test("发布进行时收下修改意见，交给发布结束后的开发轮次", { skip: !dbUrl }, async () => {
  const { db, machine, task, sid } = await fixture();
  const work = (await claim(machine))!;
  await ingestEvents(sid, work.leaseId, machine, []);
  await db.prepare(`UPDATE tasks SET stage='publishing',merge_sha='1234567' WHERE id=?`).bind(task.id).run();
  assert.deepEqual(await sendTaskReply(task.id, "修一下上线脚本"), { ok: true, deferred: true, round: 1 });
  assert.deepEqual(await undeliveredInbox(sid, 0, "publish"), []);
  assert.deepEqual(await undeliveredInbox(sid, 0, "work"), []);
  assert.equal((await completePublish(work.leaseId, machine, "published", "成功")).ok, true);
  const next = (await claim(machine))!;
  assert.equal(next.task.sessionId, sid);
  assert.equal(next.task.round, 2);
  assert.equal((await undeliveredInbox(sid, 0, "work"))[0].body, "修一下上线脚本");
});
