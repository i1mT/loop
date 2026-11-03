// 接入：外部系统把任务送进来的两种方式——SDK（嵌入网站前端，公钥 + 站点白名单）与 API（服务端推送，项目密钥）。
// 函数显式接收 Db，便于对真实 Postgres 做集成测试。
import type { Db } from "./pg.ts";
import { now } from "./time.ts";

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
const randomHex = (bytes: number) => hex(crypto.getRandomValues(new Uint8Array(bytes)));
export const newId = () => crypto.randomUUID();

export async function sha256Hex(s: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))));
}

// ---------------------------------------------------------------- SDK 来源

export interface SdkSource {
  id: string;
  project_id: string;
  key: string;
  allowed_origins: string | null;
  identity_secret: string;
  enabled: number;
  created_at: number;
}

/** 取项目的 SDK 来源；还没有就创建（公钥可以写进前端，身份密钥只给接入方后端） */
export async function ensureSdkSource(db: Db, projectId: string): Promise<SdkSource> {
  const cur = await db.prepare(`SELECT * FROM sdk_sources WHERE project_id=?`).bind(projectId).first<SdkSource>();
  if (cur) return cur;
  const row: SdkSource = { id: newId(), project_id: projectId, key: `pk_${randomHex(12)}`, allowed_origins: null, identity_secret: randomHex(32), enabled: 1, created_at: now() };
  await db
    .prepare(`INSERT INTO sdk_sources (id, project_id, key, allowed_origins, identity_secret, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (project_id) DO NOTHING`)
    .bind(row.id, row.project_id, row.key, row.allowed_origins, row.identity_secret, row.enabled, row.created_at)
    .run();
  return (await db.prepare(`SELECT * FROM sdk_sources WHERE project_id=?`).bind(projectId).first<SdkSource>())!;
}

export async function getSourceByKey(db: Db, key: string): Promise<SdkSource | null> {
  if (!/^pk_[0-9a-f]{24}$/.test(key)) return null;
  const s = await db.prepare(`SELECT * FROM sdk_sources WHERE key=?`).bind(key).first<SdkSource>();
  return s && s.enabled ? s : null;
}

/** 允许的站点：每行或逗号分隔一个，形如 https://app.example.com 或 https://*.example.com；留空表示不限制 */
export function normalizeOrigins(raw: string | null | undefined): { value: string | null; error: string | null } {
  const items = (raw ?? "").split(/[\s,]+/).filter(Boolean);
  for (const it of items) {
    if (it === "*") continue;
    if (!/^https?:\/\/(\*\.)?[A-Za-z0-9.-]+(:\d+)?\/?$/.test(it)) return { value: null, error: `站点格式不对：${it}（应形如 https://app.example.com 或 https://*.example.com）` };
  }
  return { value: items.length ? items.map((x) => x.replace(/\/$/, "")).join("\n") : null, error: null };
}

export async function updateSdkSource(db: Db, projectId: string, patch: { allowedOrigins?: string | null; enabled?: boolean }): Promise<string | null> {
  const s = await ensureSdkSource(db, projectId);
  let origins = s.allowed_origins;
  if ("allowedOrigins" in patch) {
    const n = normalizeOrigins(patch.allowedOrigins);
    if (n.error) return n.error;
    origins = n.value;
  }
  await db.prepare(`UPDATE sdk_sources SET allowed_origins=?, enabled=? WHERE project_id=?`).bind(origins, patch.enabled === undefined ? s.enabled : patch.enabled ? 1 : 0, projectId).run();
  return null;
}

/** 重新生成：公钥（旧公钥立即失效，需要换掉网站里的 data-key）或身份密钥（需要换掉接入方后端的环境变量） */
export async function rotateSdkSecret(db: Db, projectId: string, what: "key" | "identity"): Promise<void> {
  await ensureSdkSource(db, projectId);
  if (what === "key") await db.prepare(`UPDATE sdk_sources SET key=? WHERE project_id=?`).bind(`pk_${randomHex(12)}`, projectId).run();
  else await db.prepare(`UPDATE sdk_sources SET identity_secret=? WHERE project_id=?`).bind(randomHex(32), projectId).run();
}

// ---------------------------------------------------------------- API 密钥

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

/** 创建项目 API 密钥。明文只在创建时返回一次，库里只存哈希。 */
export async function createApiKey(db: Db, projectId: string, name: string): Promise<{ id: string; secret: string }> {
  const secret = `lp_${randomHex(24)}`;
  const id = newId();
  await db
    .prepare(`INSERT INTO api_keys (id, project_id, name, key_hash, key_prefix, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .bind(id, projectId, name.trim().slice(0, 60) || "未命名", await sha256Hex(secret), secret.slice(0, 7), now())
    .run();
  return { id, secret };
}

export async function listApiKeys(db: Db, projectId: string): Promise<ApiKeyView[]> {
  const rows = (
    await db
      .prepare(`SELECT id, name, key_prefix AS prefix, created_at AS "createdAt", last_used_at AS "lastUsedAt", revoked_at AS "revokedAt" FROM api_keys WHERE project_id=? ORDER BY created_at DESC`)
      .bind(projectId)
      .all<ApiKeyView>()
  ).results;
  return rows.map((r) => ({ ...r, createdAt: Number(r.createdAt), lastUsedAt: r.lastUsedAt == null ? null : Number(r.lastUsedAt), revokedAt: r.revokedAt == null ? null : Number(r.revokedAt) }));
}

export async function revokeApiKey(db: Db, projectId: string, keyId: string): Promise<boolean> {
  const r = await db.prepare(`UPDATE api_keys SET revoked_at=? WHERE id=? AND project_id=? AND revoked_at IS NULL`).bind(now(), keyId, projectId).run();
  return r.meta.changes > 0;
}

/** 用密钥换项目；已撤销或不存在返回 null。顺带记录最近使用时间。 */
export async function authenticateApiKey(db: Db, secret: string): Promise<{ projectId: string; keyId: string } | null> {
  if (!/^lp_[0-9a-f]{48}$/.test(secret)) return null;
  const row = await db.prepare(`SELECT id, project_id FROM api_keys WHERE key_hash=? AND revoked_at IS NULL`).bind(await sha256Hex(secret)).first<{ id: string; project_id: string }>();
  if (!row) return null;
  await db.prepare(`UPDATE api_keys SET last_used_at=? WHERE id=?`).bind(now(), row.id).run();
  return { projectId: row.project_id, keyId: row.id };
}

// ---------------------------------------------------------------- 频率限制

/** 项目在时间窗口内由某个来源创建的任务数（用任务表本身计数，不需要额外的存储） */
export async function recentSourceTasks(db: Db, projectId: string, source: "sdk" | "api", windowMs: number): Promise<number> {
  const r = await db.prepare(`SELECT COUNT(*) AS n FROM tasks WHERE project_id=? AND source=? AND created_at>?`).bind(projectId, source, now() - windowMs).first<{ n: number }>();
  return Number(r?.n ?? 0);
}

/** 返回超限说明；没超限返回 null。SDK 面向公众，限制更严；API 面向可信的服务端。 */
export async function rateLimited(db: Db, projectId: string, source: "sdk" | "api"): Promise<string | null> {
  const [perMin, perDay] = source === "sdk" ? [10, 300] : [60, 5000];
  if ((await recentSourceTasks(db, projectId, source, 60_000)) >= perMin) return "提交太频繁，请稍后再试";
  if ((await recentSourceTasks(db, projectId, source, 86_400_000)) >= perDay) return "今天的提交次数已达上限";
  return null;
}

// ---------------------------------------------------------------- 提交者可见的进度

/** 给提交者看的进度文案（不暴露内部细节） */
export const REPORTER_LABEL: Record<string, string> = {
  received: "已收到",
  batched: "已收到",
  held: "已收到",
  queued: "处理中",
  running: "处理中",
  needs_you: "处理中",
  plan_reviewing: "处理中",
  plan_approved: "处理中",
  reviewing: "处理中",
  approved: "处理中",
  publishing: "即将上线",
  published: "已上线",
  rejected: "已关闭",
  failed: "处理遇到问题",
  cancelled: "已关闭",
};

/** SDK 查询单个任务进度用的令牌：只能查这一个任务。用服务端密钥做 HMAC。 */
export async function statusToken(secret: string, taskId: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`status:${taskId}`)))).slice(0, 32);
}
