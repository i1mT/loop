// 方案内容按版本保留；执行阶段单独保存，恢复时不会覆盖历史。
export const TASK_PLAN_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS task_plan_rounds (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, round INTEGER NOT NULL, binding_id TEXT NOT NULL, wiki_url TEXT NOT NULL,
    phase TEXT NOT NULL DEFAULT 'analyzing', revision INTEGER NOT NULL DEFAULT 1,
    baseline_head TEXT, document_url TEXT, sync_error TEXT, continuation_id TEXT,
    approved_revision INTEGER, retry_at BIGINT NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0,
    updated_at BIGINT NOT NULL, PRIMARY KEY(task_id, round))`,
  `CREATE TABLE IF NOT EXISTS task_plans (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, round INTEGER NOT NULL, revision INTEGER NOT NULL,
    title TEXT NOT NULL DEFAULT '', markdown TEXT NOT NULL, content_hash TEXT NOT NULL, created_at BIGINT NOT NULL,
    PRIMARY KEY(task_id, round, revision))`,
  `ALTER TABLE task_plans ADD COLUMN IF NOT EXISTS title TEXT NOT NULL DEFAULT ''`,
  `CREATE TABLE IF NOT EXISTS task_plan_records (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE, round INTEGER NOT NULL, kind TEXT NOT NULL,
    markdown TEXT NOT NULL, content_hash TEXT NOT NULL, synced_hash TEXT, sync_error TEXT,
    retry_at BIGINT NOT NULL DEFAULT 0, locked_until BIGINT NOT NULL DEFAULT 0, updated_at BIGINT NOT NULL,
    PRIMARY KEY(task_id, round, kind))`,
];
