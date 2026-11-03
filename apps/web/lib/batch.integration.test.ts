// 集成测试：小问题合并（反馈与任务解耦）。对真实 Postgres（Neon dev 分支）；没有 DATABASE_URL 时跳过。
// 全局设置存在 kv 里，测试前后保存并还原。Jev 用注入的假分类器，不发网络请求。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { migrate } from "./migrations.ts";
import { useDb } from "./db.ts";
import { hello } from "./machines.ts";
import { createProject, getTask, listTasks, restartTask, setProjectArchived, setStage } from "./tasks.ts";
import { claim, iterateTask } from "./daemon-api.ts";
import { feedbackProgress, flushPool, getAllPools, getBatchSettings, getPool, listTaskFeedbacks, saveBatchSettings, submitFeedback, withdrawFeedback, type BatchSettings } from "./batch.ts";
import type { Classification, Scale } from "./classify.ts";

const url = process.env.DATABASE_URL;
const skip = url ? false : "没有 DATABASE_URL，跳过集成测试";
const run = `b${Date.now()}`;
const M = `${run}-m`;

let db: Db | null = null;
let saved: BatchSettings | null = null;
const projectIds: string[] = [];

const cls = (scale: Scale | null, suspicious = false): Classification => ({ scale, confidence: scale ? 0.9 : null, suspicious, source: scale ? "model" : "none" });
/** 假分类器：标题里写 tiny/small/medium/large 就返回对应规模，含 sus 则可疑，含 none 则没有判定 */
const fake = async (text: string): Promise<Classification> => {
  const m = text.match(/\b(tiny|small|medium|large)\b/);
  return cls(text.includes("none") ? null : ((m?.[1] as Scale | undefined) ?? "tiny"), text.includes("sus"));
};
const deps = { key: "test-key", classify: fake };

async function setup(): Promise<Db> {
  if (db) return db;
  db = new Db(url!);
  await migrate(db);
  useDb(db);
  saved = await getBatchSettings(db);
  await saveBatchSettings(db, { enabled: true, maxScale: "small", size: 3 });
  await hello(db, { machineId: M, name: "m", os: "darwin", agents: [{ kind: "grok", installed: true, version: "1", acp: true, note: null }, { kind: "claude", installed: true, version: "1", acp: true, note: null }] });
  return db;
}
async function project(d: Db, name: string) {
  const p = await createProject({ name: `${name}-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  projectIds.push(p.id);
  return p;
}

after(async () => {
  if (!db) return;
  if (saved) await saveBatchSettings(db, saved);
  for (const id of projectIds) {
    await db.prepare(`DELETE FROM feedbacks WHERE project_id=?`).bind(id).run();
    await db.prepare(`DELETE FROM tasks WHERE project_id=?`).bind(id).run();
    await db.prepare(`DELETE FROM projects WHERE id=?`).bind(id).run();
  }
  await db.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(M).run();
  await db.prepare(`DELETE FROM machines WHERE id=?`).bind(M).run();
});

test("小反馈进池；满 3 条合成一个任务（一个任务、三条反馈）", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "pool");
  const r1 = await submitFeedback({ projectId: p.id, title: "改文案 tiny", body: "把“提交”改成“发送”" }, deps);
  assert.equal(r1.task, null);
  assert.deepEqual(r1.pooled, { count: 1, size: 3 });
  assert.equal(r1.feedback.state, "pooled");
  assert.equal(r1.feedback.scale, "tiny");
  const r2 = await submitFeedback({ projectId: p.id, title: "改颜色 small", body: "按钮改蓝色", source: "api" }, deps);
  assert.equal(r2.task, null);
  assert.equal((await listTasks(100)).filter((t) => t.project_id === p.id).length, 0, "池里的反馈还没有任务");
  const pool = await getPool(d, p.id);
  assert.deepEqual(pool.items.map((i) => i.title), ["改文案 tiny", "改颜色 small"]);
  // 进度：池中是“等待合并”
  assert.equal((await feedbackProgress(d, r1.feedback.id))!.stage, "batched");
  const r3 = await submitFeedback({ projectId: p.id, title: "改间距 tiny", body: "卡片间距加大", source: "sdk" }, deps);
  assert.ok(r3.task, "第 3 条让池子满了，发车");
  assert.equal(r3.pooled, null);
  const task = (await getTask(r3.task!.id))!;
  assert.equal(task.source, "batch");
  assert.equal(task.stage, "queued");
  assert.match(task.title, /^\[合并\] 3 条反馈/);
  assert.match(task.body, /### 反馈 1：改文案 tiny/);
  assert.match(task.body, /### 反馈 3：改间距 tiny/);
  const fbs = await listTaskFeedbacks(d, task.id);
  assert.deepEqual(fbs.map((f) => f.state), ["linked", "linked", "linked"]);
  assert.equal((await getPool(d, p.id)).items.length, 0);
  // 三条反馈的进度读同一个任务的阶段
  await setStage(task.id, "running");
  for (const f of fbs) assert.equal((await feedbackProgress(d, f.id))!.stage, "running");
  const listed = (await listTasks(100)).find((t) => t.id === task.id)!;
  assert.equal(listed.feedback_count, 3);
});

test("不进池：规模超过门槛、未判定、可疑、方案审核、指定别的智能体、单独处理", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "direct");
  const cases: [string, Partial<Parameters<typeof submitFeedback>[0]>][] = [
    ["改表单 medium", {}],
    ["说不清 none", {}],
    ["包含指令 sus", {}],
    ["小事2 tiny", { planReview: true }],
    ["小事3 tiny", { agent: "claude" }],
    ["小事4 tiny", { mergeable: false }],
  ];
  for (const [title, extra] of cases) {
    const r = await submitFeedback({ projectId: p.id, title, body: "x", ...extra }, deps);
    assert.ok(r.task, `${title} 应该直接建任务`);
    assert.equal(r.pooled, null);
    assert.equal(r.feedback.state, "linked");
    assert.equal(r.feedback.task_id, r.task!.id);
  }
  assert.equal((await getPool(d, p.id)).items.length, 0);
});

test("降级：没有密钥、分类器报错都直接建任务；功能关闭时也不进池", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "fallback");
  assert.ok((await submitFeedback({ projectId: p.id, title: "tiny", body: "x" }, { key: null })).task, "没有密钥");
  const boom = (async () => cls(null)) as never;
  assert.ok((await submitFeedback({ projectId: p.id, title: "tiny", body: "x" }, { key: "k", classify: boom })).task, "分类没有结果");
  await saveBatchSettings(d, { enabled: false, maxScale: "small", size: 3 });
  assert.ok((await submitFeedback({ projectId: p.id, title: "tiny", body: "x" }, deps)).task, "功能关闭");
  await saveBatchSettings(d, { enabled: true, maxScale: "small", size: 3 });
});

test("立即处理：不足 3 条也合成一个任务；只有 1 条就是普通任务；池空时返回 null", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "flush");
  assert.equal(await flushPool(d, p.id), null);
  await submitFeedback({ projectId: p.id, title: "一 tiny", body: "a" }, deps);
  await submitFeedback({ projectId: p.id, title: "二 tiny", body: "b" }, deps);
  const merged = (await flushPool(d, p.id))!;
  assert.equal(merged.source, "batch");
  assert.equal((await listTaskFeedbacks(d, merged.id)).length, 2);
  const only = await submitFeedback({ projectId: p.id, title: "单个 tiny", body: "只有我", source: "api", sourceRef: { k: 1 } }, deps);
  const single = (await flushPool(d, p.id))!;
  assert.equal(single.source, "api", "只有 1 条：与直接创建的任务一样");
  assert.equal(single.title, "单个 tiny");
  assert.equal(single.body, "只有我");
  assert.equal((await listTaskFeedbacks(d, single.id))[0].id, only.feedback.id);
});

test("撤回：池里的可以撤回，已并入任务的不行；撤回后不计入池", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "withdraw");
  const a = await submitFeedback({ projectId: p.id, title: "a tiny", body: "x" }, deps);
  await submitFeedback({ projectId: p.id, title: "b tiny", body: "x" }, deps);
  assert.deepEqual(await withdrawFeedback(d, a.feedback.id), { ok: true });
  assert.match((await withdrawFeedback(d, a.feedback.id)).error!, /已经撤回/);
  assert.equal((await feedbackProgress(d, a.feedback.id))!.stage, "cancelled");
  assert.equal((await getPool(d, p.id)).items.length, 1);
  const t = (await flushPool(d, p.id))!;
  const f = (await listTaskFeedbacks(d, t.id))[0];
  assert.match((await withdrawFeedback(d, f.id)).error!, /已经并入任务/);
  assert.match((await withdrawFeedback(d, "nope")).error!, /不存在/);
});

test("并发发车不会重复占用同一条反馈", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "race");
  // 先塞 2 条（不触发发车），再并发提交第 3、4 条
  await submitFeedback({ projectId: p.id, title: "r1 tiny", body: "x" }, deps);
  await submitFeedback({ projectId: p.id, title: "r2 tiny", body: "x" }, deps);
  const rs = await Promise.all([1, 2].map((i) => submitFeedback({ projectId: p.id, title: `r${i + 2} tiny`, body: "x" }, deps)));
  const tasks = rs.map((r) => r.task).filter(Boolean);
  const all = (await d.prepare(`SELECT state, task_id FROM feedbacks WHERE project_id=?`).bind(p.id).all<{ state: string; task_id: string | null }>()).results;
  assert.equal(all.length, 4);
  assert.ok(tasks.length >= 1 && tasks.length <= 2);
  // 每条反馈要么在池里，要么只属于一个真实存在的任务；没有残留的占用标记
  for (const f of all) assert.ok(f.state === "pooled" ? f.task_id === null : !!f.task_id && !f.task_id.startsWith("claim:"));
  const linked = all.filter((f) => f.state === "linked");
  const perTask = new Map<string, number>();
  for (const f of linked) perTask.set(f.task_id!, (perTask.get(f.task_id!) ?? 0) + 1);
  for (const n of perTask.values()) assert.ok(n >= 3 || n === 4, "合成的任务不会少于一批（并发抢到不足的会放回）");
});

test("项目归档后：新反馈被拒绝，池里已有的也不能发车", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "archived");
  await submitFeedback({ projectId: p.id, title: "a tiny", body: "x" }, deps);
  await setProjectArchived(p.id, true);
  await assert.rejects(() => submitFeedback({ projectId: p.id, title: "b tiny", body: "x" }, deps), /已归档/);
  await assert.rejects(() => flushPool(d, p.id), /已归档/);
  assert.equal((await getPool(d, p.id)).items.length, 1, "发车失败后反馈仍在池里");
});

test("重新开始：反馈改挂到新任务；迁移回填：旧任务的反馈 ID 等于任务 ID", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "restart");
  const r = await submitFeedback({ projectId: p.id, title: "改动 medium", body: "x" }, deps);
  const old = r.task!;
  assert.equal(r.feedback.task_id, old.id);
  await setStage(old.id, "failed");
  const re = await restartTask(old.id);
  assert.ok(re.ok && re.task);
  assert.equal((await listTaskFeedbacks(d, re.task!.id)).length, 1);
  assert.equal((await listTaskFeedbacks(d, old.id)).length, 0);
  // 回填：模拟一个没有反馈的老任务，重放迁移里的回填语句
  const legacy = (await submitFeedback({ projectId: p.id, title: "老任务 medium", body: "y" }, deps)).task!;
  await d.prepare(`DELETE FROM feedbacks WHERE task_id=?`).bind(legacy.id).run();
  await d.prepare(`INSERT INTO feedbacks (id, project_id, source, source_ref, title, body, release_review, scale, scale_confidence, state, task_id, created_at, updated_at)
       SELECT id, project_id, COALESCE(source, 'manual'), source_ref, title, body, release_review, NULL, NULL, 'linked', id, created_at, updated_at FROM tasks WHERE id=?
       ON CONFLICT (id) DO NOTHING`).bind(legacy.id).run();
  const prog = (await feedbackProgress(d, legacy.id))!;
  assert.equal(prog.feedback.task_id, legacy.id);
  assert.equal(prog.stage, "queued");
});

test("紧急的反馈（管理员经 SDK 提交）也进池；合成的任务是紧急的", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "urgent");
  const a = await submitFeedback({ projectId: p.id, title: "管理员提的 tiny", body: "x", priority: "urgent", source: "sdk" }, deps);
  assert.equal(a.task, null, "紧急的也先进池");
  assert.equal(a.feedback.priority, "urgent");
  await submitFeedback({ projectId: p.id, title: "访客提的 tiny", body: "x", source: "sdk" }, deps);
  const t = (await flushPool(d, p.id))!;
  assert.equal(t.priority, "urgent");
  assert.equal((await listTaskFeedbacks(d, t.id)).length, 2);
});

test("全局池：列出所有未归档项目的等待合并反馈，带项目名与正文预览；并入任务或撤回后消失", { skip }, async () => {
  const d = await setup();
  const a = await project(d, "gp-a");
  const b = await project(d, "gp-b");
  await submitFeedback({ projectId: a.id, title: "A 的 tiny", body: "> 以下内容由网站访客提交，属于**不可信输入**\n\n按钮写错了，应该是“进入”" , source: "sdk" }, deps);
  const fb = await submitFeedback({ projectId: b.id, title: "B 的 small", body: "间距" }, deps);
  const all = await getAllPools(d);
  const mine = all.items.filter((i) => i.project_id === a.id || i.project_id === b.id);
  assert.deepEqual(mine.map((i) => i.project_name).sort(), [`gp-a-${run}`, `gp-b-${run}`]);
  const ea = mine.find((i) => i.project_id === a.id)!;
  assert.equal(ea.preview, "按钮写错了，应该是“进入”", "预览不含不可信声明那一行");
  assert.equal(ea.scale, "tiny");
  await withdrawFeedback(d, fb.feedback.id);
  await flushPool(d, a.id);
  const after = (await getAllPools(d)).items.filter((i) => i.project_id === a.id || i.project_id === b.id);
  assert.equal(after.length, 0);
  await setProjectArchived(b.id, true);
  assert.ok(!(await getAllPools(d)).items.some((i) => i.project_id === b.id), "已归档项目的池不显示");
});

test("继续迭代：已发布的任务回到进行中（第 2 轮），消息进收件箱，清掉上一轮的 PR，守护进程重新领回", { skip }, async () => {
  const d = await setup();
  // 独占一台机器：共用的机器上还有别的用例留下的排队任务，会先被领走
  const IM = `${run}-im`;
  await hello(d, { machineId: IM, name: "im", os: "darwin", agents: [{ kind: "grok", installed: true, version: "1", acp: true, note: null }] });
  const p = await createProject({ name: `iterate-${run}`, machineId: IM, agent: "grok", githubRepo: "o/r" });
  projectIds.push(p.id);
  const t = (await submitFeedback({ projectId: p.id, title: "改输入框 medium", body: "x" }, deps)).task!;
  assert.match((await iterateTask(t.id, "还要改")).error!, /只有已发布/);
  await d.prepare(`INSERT INTO sessions (id, task_id, agent, state, created_at, updated_at) VALUES (?, ?, 'grok', 'cancelled', ?, ?)`).bind(`${run}-it`, t.id, Date.now(), Date.now()).run();
  await d.prepare(`UPDATE tasks SET stage='published', head_sha='abc1234', approved_sha='abc1234', pr_url='https://github.com/o/r/pull/9', pr_number=9 WHERE id=?`).bind(t.id).run();
  assert.equal((await getTask(t.id))!.round, 1);
  const r = await iterateTask(t.id, "输入框要用 textarea");
  assert.deepEqual(r, { ok: true, round: 2 });
  const after = (await getTask(t.id))!;
  assert.deepEqual([after.stage, after.round, after.head_sha, after.approved_sha, after.pr_url, after.pr_number], ["running", 2, null, null, null, null]);
  const msgs = (await d.prepare(`SELECT kind, body FROM inbox WHERE session_id=? AND delivered_at IS NULL`).bind(`${run}-it`).all<{ kind: string; body: string }>()).results;
  assert.deepEqual(msgs, [{ kind: "message", body: "输入框要用 textarea" }]);
  // 守护进程领回：进行中、没有有效租约；带上轮次
  const got = (await claim(IM))!;
  assert.equal(got.task.id, t.id);
  assert.equal(got.task.round, 2);
  assert.equal(got.task.job, "work");
  await d.prepare(`DELETE FROM leases WHERE task_id=?`).bind(t.id).run();
  await d.prepare(`DELETE FROM inbox WHERE session_id=?`).bind(`${run}-it`).run();
  await d.prepare(`DELETE FROM sessions WHERE id=?`).bind(`${run}-it`).run();
  await d.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(IM).run();
  await d.prepare(`DELETE FROM machines WHERE id=?`).bind(IM).run();
});

test("飞书消息重复及并发提交只创建同一条反馈和任务", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "feishu-idempotency");
  const input = { projectId: p.id, title: "幂等需求 medium", body: "原始需求", source: "feishu" as const, mergeable: false, idempotencyKey: "message-1" };
  const results = await Promise.all([submitFeedback(input, deps), submitFeedback(input, deps)]);
  assert.equal(results[0].feedback.id, results[1].feedback.id);
  assert.equal(results[0].task!.id, results[1].task!.id);
  const repeated = await submitFeedback({ ...input, title: "不应覆盖原始内容" }, deps);
  assert.equal(repeated.task!.title, input.title);
  const count = await d.prepare(`SELECT COUNT(*)::int AS n FROM tasks WHERE project_id=?`).bind(p.id).first<{ n: number }>();
  assert.equal(count!.n, 1);
});

test("反馈持久保存后中断：重试使用预留任务和原始输入恢复", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "feishu-resume");
  const input = { projectId: p.id, title: "恢复需求", body: "需要恢复的正文", mergeable: false, idempotencyKey: "message-recovery" };
  const first = await submitFeedback(input, deps);
  await d.prepare(`DELETE FROM tasks WHERE id=?`).bind(first.task!.id).run();
  const resumed = await submitFeedback({ ...input, title: "第二次不同标题" }, deps);
  assert.equal(resumed.task!.id, first.task!.id);
  assert.equal(resumed.task!.title, "恢复需求");
});

test("占用合并池后中断：过期占用恢复并形成一个任务", { skip }, async () => {
  const d = await setup();
  const p = await project(d, "batch-resume");
  const r = await submitFeedback({ projectId: p.id, title: "tiny 恢复批次" }, deps);
  await d.prepare(`UPDATE feedbacks SET state='linked',task_id='claim:lost',updated_at=0 WHERE id=?`).bind(r.feedback.id).run();
  const task = await flushPool(d, p.id);
  assert.ok(task);
  assert.equal((await feedbackProgress(d, r.feedback.id))!.feedback.task_id, task.id);
});

test("后台扫描恢复没有客户端重试的任务创建和批次占用", { skip }, async () => {
  const { recoverFeedbackSubmissions } = await import("./batch.ts");
  const d = await setup();
  const p = await project(d, "background-resume");
  const direct = await submitFeedback({ projectId: p.id, title: "medium 后台恢复", mergeable: false }, deps);
  await d.prepare(`DELETE FROM tasks WHERE id=?`).bind(direct.task!.id).run();
  await d.prepare(`UPDATE feedbacks SET updated_at=0 WHERE id=?`).bind(direct.feedback.id).run();
  const pooled = await submitFeedback({ projectId: p.id, title: "tiny 后台恢复" }, deps);
  await d.prepare(`UPDATE feedbacks SET state='linked',task_id='claim:background-lost',updated_at=0 WHERE id=?`).bind(pooled.feedback.id).run();
  assert.equal(await recoverFeedbackSubmissions(d), 2);
  assert.ok(await getTask(direct.task!.id));
  assert.equal((await feedbackProgress(d, pooled.feedback.id))!.feedback.state, "linked");
  assert.ok((await feedbackProgress(d, pooled.feedback.id))!.feedback.task_id?.startsWith("batch_"));
});
