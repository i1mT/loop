import { FEISHU_NOTIFICATION_SCHEMA } from "./feishu/notification-schema.ts";
import { ROUTING_SCHEMA } from "./routing/schema.ts";
import { MACHINE_ACCESS_SCHEMA } from "./machine-access/schema.ts";
// Postgres（Neon）迁移：版本记在 kv.schema_version，每一步幂等。迁移在事务里执行，并用咨询锁避免并发建表冲突。
import { FEISHU_MIGRATIONS } from "./feishu/schema.ts";
import { TASK_PLAN_SCHEMA } from "./task-plan/schema.ts";
import type { Db } from "./pg.ts";

// 时间戳一律 BIGINT（毫秒）；布尔用 INTEGER 0/1；自增用 BIGSERIAL。
export const MIGRATIONS: string[][] = [
  [
    `CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, repo_path TEXT NOT NULL, main_ref TEXT NOT NULL DEFAULT 'main',
      default_agent TEXT NOT NULL DEFAULT 'claude', created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
      agent TEXT NOT NULL, stage TEXT NOT NULL,
      release_review INTEGER NOT NULL, plan_review INTEGER NOT NULL, batch_eligible INTEGER NOT NULL,
      preview_slot TEXT, priority TEXT NOT NULL DEFAULT 'normal',
      error TEXT, head_sha TEXT, approved_sha TEXT, plan_approved INTEGER NOT NULL DEFAULT 0,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS leases (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, daemon_id TEXT NOT NULL, expires_at BIGINT NOT NULL, released INTEGER NOT NULL DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY, task_id TEXT NOT NULL, agent TEXT NOT NULL, state TEXT NOT NULL,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS session_events (
      session_id TEXT NOT NULL, seq INTEGER NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, at BIGINT NOT NULL,
      PRIMARY KEY (session_id, seq))`,
    `CREATE TABLE IF NOT EXISTS inbox (
      id BIGSERIAL PRIMARY KEY, session_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT,
      request_id TEXT, option_id TEXT, created_at BIGINT NOT NULL, delivered_at BIGINT)`,
    `CREATE TABLE IF NOT EXISTS notifications (
      id BIGSERIAL PRIMARY KEY, task_id TEXT NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS agents_local (
      daemon_id TEXT NOT NULL, kind TEXT NOT NULL, installed INTEGER NOT NULL, version TEXT, acp INTEGER NOT NULL,
      note TEXT, detected_at BIGINT NOT NULL, PRIMARY KEY (daemon_id, kind))`,
    `CREATE TABLE IF NOT EXISTS daemon_claude_sessions (
      daemon_id TEXT NOT NULL, session_id TEXT NOT NULL, cwd TEXT, title TEXT NOT NULL, updated_at BIGINT NOT NULL,
      PRIMARY KEY (daemon_id, session_id))`,
    `CREATE INDEX IF NOT EXISTS idx_leases_task ON leases(task_id, released)`,
    `CREATE INDEX IF NOT EXISTS idx_inbox_session ON inbox(session_id, delivered_at)`,
    `CREATE INDEX IF NOT EXISTS idx_notifications_task ON notifications(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_stage ON tasks(stage)`,
  ],
  // 2：多机器与项目绑定；任务的机器与 PR 字段。agents_local 并入 machines / machine_agents。
  [
    `CREATE TABLE IF NOT EXISTS machines (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, os TEXT, version TEXT, last_seen BIGINT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS machine_agents (
      machine_id TEXT NOT NULL, kind TEXT NOT NULL, installed INTEGER NOT NULL, version TEXT, acp INTEGER NOT NULL,
      note TEXT, detected_at BIGINT NOT NULL, PRIMARY KEY (machine_id, kind))`,
    // 以下两步必须幂等（并发的冷启动可能各自重跑一次迁移）：用 DO 块检查前置条件
    `DO $$ BEGIN
       IF to_regclass('agents_local') IS NOT NULL THEN
         INSERT INTO machines (id, name, last_seen, created_at)
           SELECT daemon_id, daemon_id, MAX(detected_at), MIN(detected_at) FROM agents_local GROUP BY daemon_id
           ON CONFLICT (id) DO NOTHING;
         INSERT INTO machine_agents (machine_id, kind, installed, version, acp, note, detected_at)
           SELECT daemon_id, kind, installed, version, acp, note, detected_at FROM agents_local
           ON CONFLICT (machine_id, kind) DO NOTHING;
         DROP TABLE agents_local;
       END IF;
     END $$`,
    `DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='daemon_claude_sessions' AND column_name='daemon_id') THEN
         ALTER TABLE daemon_claude_sessions RENAME COLUMN daemon_id TO machine_id;
       END IF;
     END $$`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS github_repo TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS machine_id TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS agent TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS local_path TEXT`,
    `UPDATE projects SET local_path = repo_path, agent = default_agent WHERE local_path IS NULL`,
    `ALTER TABLE projects ALTER COLUMN repo_path DROP NOT NULL`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS machine_id TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS branch TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pr_number INTEGER`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS pr_url TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_machine ON tasks(machine_id, stage)`,
  ],
  // 迁移 3：用户系统（better-auth 的四张核心表，列名与其约定一致）
  [
    `CREATE TABLE IF NOT EXISTS "user" ("id" TEXT NOT NULL PRIMARY KEY, "name" TEXT NOT NULL, "email" TEXT NOT NULL UNIQUE, "emailVerified" BOOLEAN NOT NULL DEFAULT FALSE, "image" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS "session" ("id" TEXT NOT NULL PRIMARY KEY, "expiresAt" TIMESTAMPTZ NOT NULL, "token" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "ipAddress" TEXT, "userAgent" TEXT, "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE)`,
    `CREATE TABLE IF NOT EXISTS "account" ("id" TEXT NOT NULL PRIMARY KEY, "accountId" TEXT NOT NULL, "providerId" TEXT NOT NULL, "userId" TEXT NOT NULL REFERENCES "user" ("id") ON DELETE CASCADE, "accessToken" TEXT, "refreshToken" TEXT, "idToken" TEXT, "accessTokenExpiresAt" TIMESTAMPTZ, "refreshTokenExpiresAt" TIMESTAMPTZ, "scope" TEXT, "password" TEXT, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS "verification" ("id" TEXT NOT NULL PRIMARY KEY, "identifier" TEXT NOT NULL, "value" TEXT NOT NULL, "expiresAt" TIMESTAMPTZ NOT NULL, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT NOW(), "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS "session_userId_idx" ON "session" ("userId")`,
    `CREATE INDEX IF NOT EXISTS "account_userId_idx" ON "account" ("userId")`,
    `CREATE INDEX IF NOT EXISTS "verification_identifier_idx" ON "verification" ("identifier")`,
  ],
  // 迁移 4：智能体设置——项目默认模型/思考程度/全局指令，任务可覆盖；机器上报各智能体可选的模型与思考程度
  [
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS models TEXT`,
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS efforts TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS model TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS effort TEXT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS instructions TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS model TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS effort TEXT`,
  ],
  // 迁移 5：模型列表按需刷新——记录上次探测时间、待处理的刷新请求与失败原因
  [
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS models_at BIGINT`,
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS probe_requested_at BIGINT`,
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS probe_error TEXT`,
  ],
  // 迁移 6：模型与思考程度属于“某台机器上的某个智能体”（在机器页配置），项目与任务不再各自带；任务仍在创建时记录当时的取值
  [
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS default_model TEXT`,
    `ALTER TABLE machine_agents ADD COLUMN IF NOT EXISTS default_effort TEXT`,
    `ALTER TABLE projects DROP COLUMN IF EXISTS model`,
    `ALTER TABLE projects DROP COLUMN IF EXISTS effort`,
  ],
  // 迁移 7：接入——SDK 来源（公钥、允许的站点、身份密钥）、项目 API 密钥；任务记录来源
  [
    `CREATE TABLE IF NOT EXISTS sdk_sources (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL UNIQUE, key TEXT NOT NULL UNIQUE, allowed_origins TEXT,
      identity_secret TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL, key_hash TEXT NOT NULL UNIQUE, key_prefix TEXT NOT NULL,
      created_at BIGINT NOT NULL, last_used_at BIGINT, revoked_at BIGINT)`,
    `CREATE INDEX IF NOT EXISTS idx_api_keys_project ON api_keys(project_id)`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_ref TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_tasks_source ON tasks(project_id, source, created_at)`,
  ],
  // 迁移 8：归档——任务与项目都可以归档（从默认列表隐藏，数据保留，可恢复）
  [
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at BIGINT`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at BIGINT`,
  ],
  // 迁移 9：反馈与任务解耦——一个任务对应 1..N 条反馈。反馈有自己的规模（Jev 判定）与状态：
  // pooled 等待合并 / linked 已归入某个任务（阶段读任务的） / withdrawn 已撤回。
  // 现有每个任务回填一条反馈，反馈 ID = 任务 ID（已发给 SDK 的 ID 与令牌继续有效）。
  [
    `CREATE TABLE IF NOT EXISTS feedbacks (
      id TEXT PRIMARY KEY, project_id TEXT NOT NULL, source TEXT NOT NULL, source_ref TEXT, title TEXT NOT NULL, body TEXT NOT NULL,
      release_review INTEGER NOT NULL DEFAULT 1, scale TEXT, scale_confidence DOUBLE PRECISION, state TEXT NOT NULL, task_id TEXT,
      created_at BIGINT NOT NULL, updated_at BIGINT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_feedbacks_pool ON feedbacks(project_id, state, created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_feedbacks_task ON feedbacks(task_id)`,
    `INSERT INTO feedbacks (id, project_id, source, source_ref, title, body, release_review, scale, scale_confidence, state, task_id, created_at, updated_at)
       SELECT id, project_id, COALESCE(source, 'manual'), source_ref, title, body, release_review, NULL, NULL, 'linked', id, created_at, updated_at FROM tasks
       ON CONFLICT (id) DO NOTHING`,
  ],
  // 迁移 10：反馈记录自己的优先级（管理员经 SDK 提交的是 urgent，也参与合并；合成的任务取成员里最高的）
  [
    `ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal'`,
    `UPDATE feedbacks f SET priority = t.priority FROM tasks t WHERE t.id = f.task_id AND f.id = t.id AND t.priority <> 'normal'`,
  ],
  // 迁移 11：任务可以在发布后继续迭代（同一个会话接着改、新开 PR、再次发布），round 是第几轮
  [`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS round INTEGER NOT NULL DEFAULT 1`],
  // 迁移 12：空间。成员共享一个空间里的项目与任务；机器可同时接在多个空间，仍由一个守护进程领取。
  [
    `CREATE TABLE IF NOT EXISTS spaces (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at BIGINT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS space_members (
      space_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY (space_id, user_id))`,
    `CREATE TABLE IF NOT EXISTS space_machines (
      space_id TEXT NOT NULL, machine_id TEXT NOT NULL, created_at BIGINT NOT NULL,
      PRIMARY KEY (space_id, machine_id))`,
    `ALTER TABLE projects ADD COLUMN IF NOT EXISTS space_id TEXT`,
    `INSERT INTO spaces (id, name, created_at) VALUES ('space_default', '默认空间', 0) ON CONFLICT (id) DO NOTHING`,
    `UPDATE projects SET space_id='space_default' WHERE space_id IS NULL`,
    `INSERT INTO space_members (space_id, user_id, role, created_at)
       SELECT 'space_default', id, 'owner', 0 FROM "user"
       ON CONFLICT (space_id, user_id) DO NOTHING`,
    `INSERT INTO space_machines (space_id, machine_id, created_at)
       SELECT 'space_default', id, 0 FROM machines
       ON CONFLICT (space_id, machine_id) DO NOTHING`,
    `INSERT INTO kv (k, v) SELECT 'batch_enabled:space_default', v FROM kv WHERE k='batch_enabled' ON CONFLICT (k) DO NOTHING`,
    `INSERT INTO kv (k, v) SELECT 'batch_max_scale:space_default', v FROM kv WHERE k='batch_max_scale' ON CONFLICT (k) DO NOTHING`,
    `INSERT INTO kv (k, v) SELECT 'batch_size:space_default', v FROM kv WHERE k='batch_size' ON CONFLICT (k) DO NOTHING`,
  ],
  // 迁移 13：账号角色，超级管理员由部署者显式创建。
  [
    `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member'`,
  ],
  // 空间飞书机器人与技术方案，后台副作用由持久日志恢复。
  [...FEISHU_MIGRATIONS, ...TASK_PLAN_SCHEMA, `ALTER TABLE feedbacks ADD COLUMN IF NOT EXISTS submission_input TEXT`],
  // 配置体验：企业归属自动验证，群名称不要求用户读取内部 ID。
  [
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS notification_chat_name TEXT`,
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS callback_verified_at BIGINT`,
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS tenant_verified_at BIGINT`,
    `ALTER TABLE feishu_chat_routes ADD COLUMN IF NOT EXISTS chat_name TEXT`,
  ],
  // 企业归属误绑自愈：记录最近一次收到消息和最近一次因企业不匹配被拒绝，设置页显示并可重置。
  [
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS last_event_at BIGINT`,
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS tenant_mismatch_at BIGINT`,
    `ALTER TABLE space_feishu_bindings ADD COLUMN IF NOT EXISTS tenant_mismatch_key TEXT`,
  ],
  // 17：已经在线上执行过的机器隔离迁移，保留原编号。
  MACHINE_ACCESS_SCHEMA,
  // 18：platform 分支已经上线的技术方案标题迁移，保留原编号。
  [`ALTER TABLE task_plans ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`],
  // 19：兼容仅执行过 platform 占位迁移的安装；幂等补齐机器隔离，不改变现有所有权、凭证或共享设置。
  MACHINE_ACCESS_SCHEMA,
  // 发布恢复：记录 PR 已合并的提交，发布失败时不再要求重建分支和 PR，直接重试发布。
  [
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS merge_sha TEXT`,
    `ALTER TABLE tasks ADD COLUMN IF NOT EXISTS merged_at BIGINT`,
    `UPDATE tasks SET merge_sha=(regexp_match(error,'PR 已合并[（(]([0-9a-f]+)'))[1],merged_at=updated_at WHERE merge_sha IS NULL AND error LIKE '%PR 已合并%'`,
  ],
  // 兼容仅执行过 platform 占位迁移的安装，保持机器隔离结构完整。
  MACHINE_ACCESS_SCHEMA,

  ROUTING_SCHEMA,
  FEISHU_NOTIFICATION_SCHEMA,
  // 项目按机器配置智能体：绑定行保存自己的智能体，以及可选的模型/思考程度覆盖（为空跟随机器上该智能体的默认配置）。
  [
    `ALTER TABLE project_machines ADD COLUMN IF NOT EXISTS agent TEXT`,
    `ALTER TABLE project_machines ADD COLUMN IF NOT EXISTS model TEXT`,
    `ALTER TABLE project_machines ADD COLUMN IF NOT EXISTS effort TEXT`,
    `UPDATE project_machines b SET agent=p.agent FROM projects p WHERE b.project_id=p.id AND b.agent IS NULL AND p.agent IS NOT NULL`,
  ],
];


/** 应用所有未执行的迁移；可重复调用 */
export async function migrate(db: Db): Promise<number> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL)`).run();
  const row = await db.prepare(`SELECT v FROM kv WHERE k='schema_version'`).first<{ v: string }>();
  let version = row ? Number(row.v) : 0;
  for (let i = version; i < MIGRATIONS.length; i++) {
    // 咨询锁：多个请求同时冷启动时，只有一个在建表，其余等待
    await db.batch([
      db.prepare(`SELECT pg_advisory_xact_lock(8734001)`),
      ...MIGRATIONS[i].map((s) => db.prepare(s)),
      db.prepare(`INSERT INTO kv (k, v) VALUES ('schema_version', ?) ON CONFLICT (k) DO UPDATE SET v=excluded.v`).bind(String(i + 1)),
    ]);
    version = i + 1;
  }
  return version;
}
