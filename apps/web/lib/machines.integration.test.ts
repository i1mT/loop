// 集成测试：对真实 Postgres（Neon dev 分支）验证多机器逻辑。没有 DATABASE_URL 时跳过。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { Db } from "./pg.ts";
import { migrate } from "./migrations.ts";
import { useDb } from "./db.ts";
import { deleteMachine, hello, listMachines, pendingProbes, requestProbe, setAgentConfig, validateBinding } from "./machines.ts";
import { createProject, createTask, getTask, setStage, listProjects, listTasks, restartTask, setProjectArchived, setTaskArchived, updateProject, updateTask } from "./tasks.ts";
import { claim, confirmPublish, ingestEvents, overrideOutcome, republishTask, restoreTask } from "./daemon-api.ts";
import { randomUUID } from "node:crypto";
import { authenticateApiKey, createApiKey, ensureSdkSource, getSourceByKey, listApiKeys, rateLimited, revokeApiKey, rotateSdkSecret, updateSdkSource } from "./integrations.ts";

const url = process.env.DATABASE_URL;
const skip = url ? false : "没有 DATABASE_URL，跳过集成测试";
const run = `t${Date.now()}`;
const A = `${run}-a`;
const B = `${run}-b`;
const agents = [
  { kind: "grok", installed: true, version: "1.0", acp: true, note: null },
  { kind: "codex", installed: true, version: "0.1", acp: false, note: "暂不能驱动" },
  { kind: "claude", installed: false, version: null, acp: false, note: "未安装" },
];

let db: Db | null = null;
async function setup(): Promise<Db> {
  if (db) return db;
  db = new Db(url!);
  await migrate(db);
  useDb(db);
  await hello(db, { machineId: A, name: "家里的电脑", os: "darwin", agents });
  await hello(db, { machineId: B, name: "公司的电脑", os: "linux", agents });
  return db;
}

after(async () => {
  if (!db) return;
  await db.prepare(`DELETE FROM leases WHERE daemon_id IN (?, ?, ?, ?, ?, ?, ?, ?)`).bind(A, B, `${run}-m1`, `${run}-m2`, `${run}-m3`, `${run}-m4`, `${run}-m5`, `${run}-m6`).run();
  await db.prepare(`DELETE FROM tasks WHERE machine_id IN (?, ?, ?, ?, ?, ?, ?, ?)`).bind(A, B, `${run}-m1`, `${run}-m2`, `${run}-m3`, `${run}-m4`, `${run}-m5`, `${run}-m6`).run();
  await db.prepare(`DELETE FROM projects WHERE machine_id IN (?, ?, ?, ?, ?, ?, ?, ?)`).bind(A, B, `${run}-m1`, `${run}-m2`, `${run}-m3`, `${run}-m4`, `${run}-m5`, `${run}-m6`).run();
  await db.prepare(`DELETE FROM machine_agents WHERE machine_id IN (?, ?, ?, ?, ?, ?, ?, ?)`).bind(A, B, `${run}-m1`, `${run}-m2`, `${run}-m3`, `${run}-m4`, `${run}-m5`, `${run}-m6`).run();
  await db.prepare(`DELETE FROM machines WHERE id IN (?, ?, ?, ?, ?, ?, ?, ?)`).bind(A, B, `${run}-m1`, `${run}-m2`, `${run}-m3`, `${run}-m4`, `${run}-m5`, `${run}-m6`).run();
});

test("hello 注册机器并上报智能体；列表里在线", { skip }, async () => {
  const d = await setup();
  const list = (await listMachines(d)).filter((m) => m.id === A || m.id === B);
  assert.equal(list.length, 2);
  const a = list.find((m) => m.id === A)!;
  assert.equal(a.name, "家里的电脑");
  assert.equal(a.online, true);
  assert.deepEqual(a.agents.map((x) => [x.kind, x.installed, x.acp]), [["claude", false, false], ["codex", true, false], ["grok", true, true]]);
});

test("绑定校验：机器不存在、未安装、不能驱动都被拒绝；合法通过", { skip }, async () => {
  const d = await setup();
  assert.match((await validateBinding(d, `${run}-none`, "grok"))!, /不存在/);
  assert.match((await validateBinding(d, A, "claude"))!, /没有安装/);
  assert.match((await validateBinding(d, A, "codex"))!, /暂不能被驱动/);
  assert.equal(await validateBinding(d, A, "grok"), null);
});

test("任务只被绑定的机器领取；其它机器领不到", { skip }, async () => {
  await setup();
  const project = await createProject({ name: `p-${run}`, machineId: A, agent: "grok", githubRepo: "o/r" });
  const task = await createTask({ projectId: project.id, title: "t" });
  assert.equal(task.machine_id, A, "任务在创建时固定机器");
  assert.equal(task.agent, "grok", "任务在创建时固定智能体");
  assert.equal(await claim(B), null, "另一台机器不应领到");
  const got = await claim(A);
  assert.equal((got!.task as { id: string }).id, task.id);
  assert.equal(await claim(B), null, "任务已被 A 领走，B 仍然领不到");
});

test("项目没有绑定时不能建任务；创建项目时绑定非法的智能体被拒绝", { skip }, async () => {
  await setup();
  await assert.rejects(() => createProject({ name: "x", machineId: A, agent: "claude" }), /没有安装/);
});

test("多任务并发：已持有的任务用 holding 排除，其它任务照常领到", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m1`;
  await hello(d, { machineId: M, name: "m1", os: "darwin", agents });
  const project = await createProject({ name: `q-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t1 = await createTask({ projectId: project.id, title: "一", priority: "urgent" });
  const t2 = await createTask({ projectId: project.id, title: "二" });
  const first = await claim(M);
  assert.equal((first!.task as { id: string }).id, t1.id);
  // 不带 holding：再领取会把自己持有的任务当作重新接管返回
  assert.equal((await claim(M))!.task.id, t1.id);
  // 带 holding：被排除，领到第二个任务
  const second = await claim(M, [t1.id]);
  assert.equal((second!.task as { id: string }).id, t2.id);
  assert.equal(await claim(M, [t1.id, t2.id]), null);
  void d;
});

test("发布领取沿用工作会话仍持有的租约，不作废重发", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m2`;
  await hello(d, { machineId: M, name: "m2", os: "darwin", agents });
  const project = await createProject({ name: `r-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: project.id, title: "待发布" });
  const work = await claim(M, []);
  assert.equal((work!.task as { id: string }).id, t.id);
  // 模拟：审核通过，任务进入 approved，工作会话仍在持有租约
  await d.prepare(`UPDATE tasks SET stage='approved', approved_sha='abc1234' WHERE id=?`).bind(t.id).run();
  const publish = await claim(M, [t.id]);
  assert.equal((publish!.task as { job: string }).job, "publish");
  assert.equal(publish!.leaseId, work!.leaseId, "同一租约，工作会话不会被当作“被收回”");
  const lease = await d.prepare(`SELECT released FROM leases WHERE id=?`).bind(work!.leaseId).first<{ released: number }>();
  assert.equal(lease!.released, 0);
});

test("重复发送同一批事件不会重新触发阶段转换（超时重试不能把发布中打回待审核）", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m3`;
  await hello(d, { machineId: M, name: "m3", os: "darwin", agents });
  const project = await createProject({ name: `s-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: project.id, title: "重复事件", releaseReview: true });
  const got = await claim(M, []);
  const sid = randomUUID();
  const batch = [
    { seq: 0, kind: "status", payload: { state: "running" }, at: Date.now() },
    { seq: 1, kind: "message", payload: { role: "agent", text: "x" }, at: Date.now() },
    { seq: 2, kind: "status", payload: { state: "idle" }, at: Date.now() },
  ];
  const first = await ingestEvents(sid, got!.leaseId, M, batch);
  assert.equal(first.ok, true);
  const stage = async () => (await d.prepare(`SELECT stage FROM tasks WHERE id=?`).bind(t.id).first<{ stage: string }>())!.stage;
  assert.equal(await stage(), "reviewing");
  // 进入发布中后，同一批事件再次到达（守护进程超时重发）
  await d.prepare(`UPDATE tasks SET stage='publishing' WHERE id=?`).bind(t.id).run();
  const again = await ingestEvents(sid, got!.leaseId, M, batch);
  assert.equal(again.ok, true);
  assert.equal(await stage(), "publishing", "重复事件不应再次触发 idle → reviewing");
  // 新的会话事件（迟到的 idle）也不能改动发布中的阶段
  await ingestEvents(sid, got!.leaseId, M, [{ seq: 3, kind: "status", payload: { state: "idle" }, at: Date.now() }]);
  assert.equal(await stage(), "publishing", "发布中的阶段只由发布结果推进");
  const n = await d.prepare(`SELECT COUNT(*) AS n FROM session_events WHERE session_id=?`).bind(sid).first<{ n: number }>();
  assert.equal(Number(n!.n), 4, "事件只保留一份");
});

test("智能体配置：模型与思考程度在智能体上设置，项目只选智能体，任务创建时取当时的配置", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m4`;
  const withOptions = [
    { kind: "grok", installed: true, version: "1", acp: true, note: null, models: [{ value: "grok-4.7", name: "Grok 4.7" }, { value: "grok-4.5", name: "Grok 4.5" }], efforts: [{ value: "high", name: "High" }, { value: "low", name: "Low" }] },
    { kind: "claude", installed: true, version: "1", acp: true, note: null, models: [{ value: "opus", name: "Opus" }, { value: "sonnet", name: "Sonnet" }] },
  ];
  await hello(d, { machineId: M, name: "m4", os: "darwin", agents: withOptions });
  const view = (await listMachines(d)).find((m) => m.id === M)!;
  assert.deepEqual(view.agents.find((a) => a.kind === "grok")!.models.map((m) => m.value), ["grok-4.7", "grok-4.5"]);
  // 再次 hello 没带模型（还没探测）：不能清空已有的模型列表，也不能动配置
  await hello(d, { machineId: M, name: "m4", agents: [{ kind: "grok", installed: true, version: "1", acp: true, note: null }] });
  assert.equal((await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "grok")!.models.length, 2);

  // 配置智能体：校验模型与思考程度
  assert.match((await setAgentConfig(d, M, "grok", { model: "nope" }))!, /没有模型/);
  assert.match((await setAgentConfig(d, M, "grok", { effort: "extreme" }))!, /思考程度/);
  assert.match((await setAgentConfig(d, M, "codex", {}))!, /没有智能体/);
  // 各智能体的思考程度取值不同：以探测到的列表为准（dsh 有 off，不在约定五档里）
  await hello(d, { machineId: M, name: "m4", agents: [{ kind: "dsh", installed: true, version: "1", acp: true, note: null, models: [{ value: "m", name: "m" }], efforts: [{ value: "off", name: "Off" }, { value: "max", name: "Max" }] }] });
  assert.equal(await setAgentConfig(d, M, "dsh", { effort: "off" }), null);
  assert.match((await setAgentConfig(d, M, "dsh", { effort: "medium" }))!, /off、max/);
  assert.equal(await setAgentConfig(d, M, "grok", { model: "grok-4.7", effort: "high" }), null);
  assert.equal(await setAgentConfig(d, M, "claude", { model: "opus" }), null);
  const cfg = (await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "grok")!;
  assert.deepEqual([cfg.defaultModel, cfg.defaultEffort], ["grok-4.7", "high"]);
  await hello(d, { machineId: M, name: "m4", agents: withOptions });
  assert.equal((await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "grok")!.defaultModel, "grok-4.7", "hello 不覆盖配置");

  // 项目只选择智能体，并带全局指令
  const p = await createProject({ name: `u-${run}`, machineId: M, agent: "grok", githubRepo: "o/r", instructions: "  用 pnpm，不要改 legacy/。 " });
  assert.equal(p.instructions, "用 pnpm，不要改 legacy/。");
  // 任务：取该智能体当前的配置；改配置只影响之后的任务
  const t1 = await createTask({ projectId: p.id, title: "默认" });
  assert.deepEqual([t1.agent, t1.model, t1.effort], ["grok", "grok-4.7", "high"]);
  await setAgentConfig(d, M, "grok", { model: "grok-4.5", effort: "low" });
  const t2 = await createTask({ projectId: p.id, title: "改配置后" });
  assert.deepEqual([t2.model, t2.effort], ["grok-4.5", "low"]);
  assert.equal((await d.prepare(`SELECT model FROM tasks WHERE id=?`).bind(t1.id).first<{ model: string }>())!.model, "grok-4.7", "已创建的任务不受影响");
  // 任务换智能体：取那个智能体的配置
  const t3 = await createTask({ projectId: p.id, title: "换智能体", agent: "claude" });
  assert.deepEqual([t3.agent, t3.model, t3.effort], ["claude", "opus", null]);
  await assert.rejects(() => createTask({ projectId: p.id, title: "x", agent: "codex" }), /没有安装/);

  // 领取：带回任务记录的模型、思考程度与项目全局指令
  const got = await claim(M, []);
  assert.equal((got!.task as { instructions: string }).instructions, "用 pnpm，不要改 legacy/。");
  assert.equal((got!.task as { model: string }).model, "grok-4.7");

  // 修改项目：只改给出的字段；清空全局指令
  const p2 = await updateProject(p.id, { instructions: "新的说明" });
  assert.deepEqual([p2.agent, p2.instructions], ["grok", "新的说明"]);
  const p3 = await updateProject(p.id, { agent: "claude" });
  assert.equal(p3.agent, "claude");
  await assert.rejects(() => updateProject(p.id, { agent: "codex" }), /没有安装/);
  assert.equal((await updateProject(p.id, { instructions: "" })).instructions, null);
});

test("按需刷新模型列表：请求 → 守护进程领取时拿到 → 上报后结清；失败记下原因", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m5`;
  const base = { kind: "grok", installed: true, version: "1", acp: true, note: null };
  await hello(d, { machineId: M, name: "m5", agents: [base, { ...base, kind: "claude" }] });
  assert.deepEqual(await pendingProbes(d, M), []);
  assert.match((await requestProbe(d, M, "codex"))!, /不可用/, "没有这个智能体");
  assert.equal(await requestProbe(d, M, "grok"), null);
  assert.deepEqual(await pendingProbes(d, M), ["grok"]);
  assert.equal((await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "grok")!.probePending, true);
  // 普通 hello（没带模型）不能结清请求
  await hello(d, { machineId: M, name: "m5", agents: [base] });
  assert.deepEqual(await pendingProbes(d, M), ["grok"]);
  // 上报了模型：结清并记录时间
  await hello(d, { machineId: M, name: "m5", agents: [{ ...base, models: [{ value: "m1", name: "M1" }] }] });
  assert.deepEqual(await pendingProbes(d, M), []);
  const g = (await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "grok")!;
  assert.equal(g.models.length, 1);
  assert.ok(g.modelsAt && g.modelsAt > 0);
  // 失败：结清请求，记下原因；再次请求会清掉旧原因
  await requestProbe(d, M, "claude");
  await hello(d, { machineId: M, name: "m5", agents: [{ ...base, kind: "claude", probeError: "没能读取到模型列表" }] });
  assert.deepEqual(await pendingProbes(d, M), []);
  assert.equal((await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "claude")!.probeError, "没能读取到模型列表");
  await requestProbe(d, M, "claude");
  assert.equal((await listMachines(d)).find((m) => m.id === M)!.agents.find((a) => a.kind === "claude")!.probeError, null);
});

test("接入：SDK 来源（自动创建、白名单、轮换）、API 密钥（只存哈希、撤销）、来源频率限制", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m6`;
  await hello(d, { machineId: M, name: "m6", agents });
  const p = await createProject({ name: `i-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });

  // SDK 来源：第一次访问自动创建，之后同一个；公钥格式固定
  const s1 = await ensureSdkSource(d, p.id);
  assert.match(s1.key, /^pk_[0-9a-f]{24}$/);
  assert.equal((await ensureSdkSource(d, p.id)).key, s1.key);
  assert.equal((await getSourceByKey(d, s1.key))!.project_id, p.id);
  assert.equal(await getSourceByKey(d, "pk_" + "0".repeat(24)), null);
  assert.match((await updateSdkSource(d, p.id, { allowedOrigins: "not-a-url" }))!, /站点格式不对/);
  assert.equal(await updateSdkSource(d, p.id, { allowedOrigins: "https://a.com\nhttps://*.b.com" }), null);
  assert.equal((await ensureSdkSource(d, p.id)).allowed_origins, "https://a.com\nhttps://*.b.com");
  await updateSdkSource(d, p.id, { enabled: false });
  assert.equal(await getSourceByKey(d, s1.key), null, "停用后按公钥查不到");
  await updateSdkSource(d, p.id, { enabled: true });
  await rotateSdkSecret(d, p.id, "key");
  const s2 = await ensureSdkSource(d, p.id);
  assert.notEqual(s2.key, s1.key);
  assert.equal(await getSourceByKey(d, s1.key), null, "旧公钥立即失效");
  await rotateSdkSecret(d, p.id, "identity");
  assert.notEqual((await ensureSdkSource(d, p.id)).identity_secret, s1.identity_secret);

  // API 密钥：明文只返回一次，库里只有哈希；撤销后失效；密钥不能跨项目
  const k = await createApiKey(d, p.id, "工单系统");
  assert.match(k.secret, /^lp_[0-9a-f]{48}$/);
  const row = await d.prepare(`SELECT key_hash, key_prefix FROM api_keys WHERE id=?`).bind(k.id).first<{ key_hash: string; key_prefix: string }>();
  assert.notEqual(row!.key_hash, k.secret);
  assert.equal(row!.key_prefix, k.secret.slice(0, 7));
  assert.deepEqual(await authenticateApiKey(d, k.secret), { projectId: p.id, keyId: k.id });
  assert.equal(await authenticateApiKey(d, "lp_" + "1".repeat(48)), null);
  assert.equal(await authenticateApiKey(d, "not-a-key"), null);
  const listed = (await listApiKeys(d, p.id))[0];
  assert.ok(listed.lastUsedAt, "记录了最近使用时间");
  assert.equal(await revokeApiKey(d, "other-project", k.id), false, "不能撤销别的项目的密钥");
  assert.equal(await revokeApiKey(d, p.id, k.id), true);
  assert.equal(await authenticateApiKey(d, k.secret), null, "撤销后立即失效");
  assert.equal(await revokeApiKey(d, p.id, k.id), false);

  // 任务记录来源；频率限制按来源与项目计数（SDK 每分钟 10 条）
  const t = await createTask({ projectId: p.id, title: "来自 SDK", source: "sdk", sourceRef: { page: "https://a.com/x" } });
  assert.equal(t.source, "sdk");
  assert.equal(JSON.parse(t.source_ref!).page, "https://a.com/x");
  assert.equal(await rateLimited(d, p.id, "sdk"), null);
  for (let i = 0; i < 9; i++) await createTask({ projectId: p.id, title: `n${i}`, source: "sdk" });
  assert.match((await rateLimited(d, p.id, "sdk"))!, /太频繁/);
  assert.equal(await rateLimited(d, p.id, "api"), null, "API 来源单独计数");
});

test("人工改结果：失败的发布可改成已发布；发布结束后由人确认成功/失败", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m4`;
  await hello(d, { machineId: M, name: "m4", os: "darwin", agents });
  const project = await createProject({ name: `o-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: project.id, title: "人工改结果" });
  const stage = async () => (await d.prepare(`SELECT stage FROM tasks WHERE id=?`).bind(t.id).first<{ stage: string }>())!.stage;
  // 失败（发布命令缺失）→ 人工标记为已发布
  await d.prepare(`UPDATE tasks SET stage='failed', error='缺少约定' WHERE id=?`).bind(t.id).run();
  assert.equal((await overrideOutcome(t.id, "published", "PR 合并后自动部署")).ok, true);
  assert.equal(await stage(), "published");
  assert.equal((await overrideOutcome(t.id, "failed", "")).ok, false, "已发布不能再被改");
  // 待确认发布 → 确认成功 / 失败
  await d.prepare(`UPDATE tasks SET stage='publish_review', error='总结' WHERE id=?`).bind(t.id).run();
  assert.equal((await confirmPublish(t.id, true, "")).ok, true);
  assert.equal(await stage(), "published");
  assert.equal((await confirmPublish(t.id, false, "")).ok, false, "不在待确认阶段不能确认");
});

test("归档与编辑：任务只有结束后才能归档；正文只在没开始时可改；归档项目拒绝新任务；失败任务可重新开始", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m5`;
  await hello(d, { machineId: M, name: "m5", os: "darwin", agents });
  const project = await createProject({ name: `a-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: project.id, title: "旧标题", body: "旧正文" });
  // 排队中：标题与正文都能改
  assert.equal((await updateTask(t.id, { title: "新标题", body: "新正文" })).ok, true);
  assert.equal((await getTask(t.id))!.body, "新正文");
  // 没结束不能归档
  assert.equal((await setTaskArchived(t.id, true)).ok, false);
  // 开始后只能改标题
  await d.prepare(`UPDATE tasks SET stage='running' WHERE id=?`).bind(t.id).run();
  assert.equal((await updateTask(t.id, { body: "再改" })).ok, false);
  assert.equal((await updateTask(t.id, { title: "只改标题" })).ok, true);
  // 失败后：可重新开始（新任务，旧任务不变），可归档，列表按归档过滤
  await d.prepare(`UPDATE tasks SET stage='failed' WHERE id=?`).bind(t.id).run();
  const re = await restartTask(t.id);
  assert.equal(re.ok, true);
  assert.equal(re.task!.stage, "queued");
  assert.equal(re.task!.title, "只改标题");
  assert.equal((await getTask(t.id))!.stage, "failed");
  assert.equal((await setTaskArchived(t.id, true)).ok, true);
  assert.ok(!(await listTasks(500)).some((x) => x.id === t.id), "默认列表不含已归档");
  assert.ok((await listTasks(500, true)).some((x) => x.id === t.id), "归档列表包含");
  assert.equal((await updateTask(t.id, { title: "x" })).ok, false, "已归档不能编辑");
  assert.equal((await setTaskArchived(t.id, false)).ok, true);
  // 归档项目：拒绝新任务，列表过滤，可恢复
  await setProjectArchived(project.id, true);
  await assert.rejects(() => createTask({ projectId: project.id, title: "x" }), /已归档/);
  assert.ok(!(await listProjects()).some((p) => p.id === project.id));
  assert.ok((await listProjects(true)).some((p) => p.id === project.id));
  await setProjectArchived(project.id, false);
  assert.equal((await createTask({ projectId: project.id, title: "恢复后可建" })).stage, "queued");
});

test("删除机器：在线、有项目绑定、有未结束任务时拒绝；离线且无关联时删除", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m7`;
  await hello(d, { machineId: M, name: "m7", os: "darwin", agents });
  assert.match((await deleteMachine(d, M)).error ?? "", /在线/);
  await d.prepare(`UPDATE machines SET last_seen=1 WHERE id=?`).bind(M).run();
  const project = await createProject({ name: `dm-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  assert.match((await deleteMachine(d, M)).error ?? "", /绑定/);
  await setProjectArchived(project.id, true);
  assert.match((await deleteMachine(d, M)).error ?? "", /绑定/, "已归档的项目也算绑定");
  await d.prepare(`DELETE FROM projects WHERE id=?`).bind(project.id).run();
  const last = await deleteMachine(d, M);
  assert.equal(last.ok, true, last.error ?? "");
  assert.equal((await d.prepare(`SELECT id FROM machines WHERE id=?`).bind(M).first()), null);
  assert.equal((await deleteMachine(d, M)).error, "机器不存在");
});

test("已进入待审核却没回传过提交（推送失败且租约丢了）：重新领回去补发；回传过提交的不再领", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m7`;
  await hello(d, { machineId: M, name: "m7", os: "darwin", agents: [{ kind: "grok", installed: true, version: "1", acp: true, note: null }] });
  const p = await createProject({ name: `p7-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: p.id, title: "漏发的任务" });
  const first = (await claim(M))!;
  assert.equal(first.task.id, t.id);
  await setStage(t.id, "reviewing");
  await d.prepare(`UPDATE leases SET released=1 WHERE task_id=?`).bind(t.id).run(); // 租约被收回
  const again = await claim(M);
  assert.equal(again?.task.id, t.id, "待审核、没有提交、没有有效租约：重新领回");
  assert.equal(again?.task.job, "work");
  // 已有有效租约时，同一台机器带着 holding 不会重复领到
  assert.equal(await claim(M, [t.id]), null);
  await d.prepare(`UPDATE tasks SET head_sha='abc1234' WHERE id=?`).bind(t.id).run();
  await d.prepare(`UPDATE leases SET released=1 WHERE task_id=?`).bind(t.id).run();
  assert.equal(await claim(M), null, "已经回传过提交的待审核任务不再领取");
  await d.prepare(`DELETE FROM leases WHERE task_id=?`).bind(t.id).run();
  await d.prepare(`DELETE FROM tasks WHERE project_id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM feedbacks WHERE project_id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM projects WHERE id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(M).run();
  await d.prepare(`DELETE FROM machines WHERE id=?`).bind(M).run();
});

test("人工恢复与重新创建 PR：取消的任务改回待审核后被守护进程重新领回；待审核无 PR 时可请求重试", { skip }, async () => {
  const d = await setup();
  const M = `${run}-m8`;
  await hello(d, { machineId: M, name: "m8", os: "darwin", agents: [{ kind: "grok", installed: true, version: "1", acp: true, note: null }] });
  const p = await createProject({ name: `p8-${run}`, machineId: M, agent: "grok", githubRepo: "o/r" });
  const t = await createTask({ projectId: p.id, title: "被误取消的任务" });
  assert.match((await restoreTask(t.id)).error!, /不能恢复/, "排队中的任务不能恢复");
  const c = (await claim(M))!;
  assert.equal(c.task.id, t.id);
  await d.prepare(`INSERT INTO sessions (id, task_id, agent, state, created_at, updated_at) VALUES (?, ?, 'grok', 'idle', ?, ?)`).bind(`${run}-s8`, t.id, Date.now(), Date.now()).run();
  await setStage(t.id, "cancelled");
  assert.deepEqual(await restoreTask(t.id), { ok: true });
  const back = (await getTask(t.id))!;
  assert.deepEqual([back.stage, back.head_sha, back.pr_url], ["reviewing", null, null]);
  // 守护进程重新领回（旧租约已释放，待审核且没有提交）
  assert.equal((await claim(M))?.task.id, t.id);
  // 待审核且没有 PR：可以请求重试；有 PR 后不再需要
  assert.deepEqual(await republishTask(t.id), { ok: true });
  const inbox = (await d.prepare(`SELECT kind FROM inbox WHERE session_id=?`).bind(`${run}-s8`).all<{ kind: string }>()).results;
  assert.deepEqual(inbox.map((i) => i.kind), ["republish"]);
  await d.prepare(`UPDATE tasks SET pr_url='https://x/pr/1', pr_number=1 WHERE id=?`).bind(t.id).run();
  assert.match((await republishTask(t.id)).error!, /已经创建/);
  // 从没开过会话的取消任务没有可恢复的内容
  const t2 = await createTask({ projectId: p.id, title: "没开始就取消" });
  await setStage(t2.id, "cancelled");
  assert.match((await restoreTask(t2.id)).error!, /没有开始过会话/);
  await d.prepare(`DELETE FROM inbox WHERE session_id=?`).bind(`${run}-s8`).run();
  await d.prepare(`DELETE FROM sessions WHERE id=?`).bind(`${run}-s8`).run();
  await d.prepare(`DELETE FROM leases WHERE daemon_id=?`).bind(M).run();
  await d.prepare(`DELETE FROM tasks WHERE project_id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM feedbacks WHERE project_id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM projects WHERE id=?`).bind(p.id).run();
  await d.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(M).run();
  await d.prepare(`DELETE FROM machines WHERE id=?`).bind(M).run();
});
