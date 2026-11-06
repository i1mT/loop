// 机器：每台电脑上的守护进程以机器身份注册（hello），上报自己的智能体；项目绑定到"某台机器上的某个智能体"。
// 函数都显式接收 Db，便于对真实 Postgres 做集成测试。
import type { Db } from "./pg.ts";

import { now } from "./time.ts";
import { routingLock } from "./machine-access/policy.ts";

/** 超过这个时间没有联系，就认为机器离线（空闲轮询间隔 60 秒，留出余量） */
export const ONLINE_MS = 3 * 60_000;

export interface Choice {
  value: string;
  name: string;
}

export interface DiscoveredAgent {
  kind: string;
  bin?: string;
  installed: boolean;
  version: string | null;
  acp: boolean;
  note: string | null;
  /** 该智能体可选的模型与思考程度（守护进程探测得到；还没探测到时为空） */
  models?: Choice[] | null;
  efforts?: Choice[] | null;
  /** 这次探测失败的原因（只在响应刷新请求失败时带） */
  probeError?: string | null;
}

/** 思考程度的取值集合（claude、codex、grok 共有的约定值；某个模型不支持时守护进程会忽略并记录） */
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;

export interface ClaudeSessionRow {
  id: string;
  cwd: string | null;
  title: string;
  updatedAt: number;
}

export interface HelloBody {
  machineId: string;
  name?: string;
  os?: string;
  version?: string;
  agents: DiscoveredAgent[];
  claudeSessions?: ClaudeSessionRow[];
}

export interface MachineView {
  id: string;
  name: string;
  os: string | null;
  version: string | null;
  lastSeen: number;
  online: boolean;
  ownerId: string | null;
  owned: boolean;
  shared: boolean;
  legacyAuth: boolean;
  agents: (DiscoveredAgent & { detectedAt: number; models: Choice[]; efforts: Choice[]; modelsAt: number | null; probePending: boolean; probeError: string | null; defaultModel: string | null; defaultEffort: string | null })[];
}

export function isOnline(lastSeen: number, at = now()): boolean {
  return at - lastSeen <= ONLINE_MS;
}

/** 机器 ID：小写字母、数字、连字符、下划线、点，1–64 个字符 */
export function validMachineId(id: unknown): id is string {
  return typeof id === "string" && /^[a-z0-9][a-z0-9._-]{0,63}$/.test(id);
}

export async function touchMachine(db: Db, machineId: string): Promise<void> {
  await db.prepare(`UPDATE machines SET last_seen=? WHERE id=?`).bind(now(), machineId).run();
}

/** 注册或更新机器，并刷新它的智能体与 Claude 会话列表 */
export async function hello(db: Db, body: HelloBody): Promise<void> {
  const t = now();
  await db
    .prepare(
      `INSERT INTO machines (id, name, os, version, last_seen, created_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET name=CASE WHEN machines.owner_user_id IS NULL THEN excluded.name ELSE machines.name END, os=excluded.os, version=excluded.version, last_seen=excluded.last_seen`,
    )
    .bind(body.machineId, body.name ?? body.machineId, body.os ?? null, body.version ?? null, t, t)
    .run();

  for (const a of body.agents) {
    await db
      .prepare(
        `INSERT INTO machine_agents (machine_id, kind, installed, version, acp, note, detected_at, models, efforts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (machine_id, kind) DO UPDATE SET installed=excluded.installed, version=excluded.version, acp=excluded.acp, note=excluded.note, detected_at=excluded.detected_at,
           models=COALESCE(excluded.models, machine_agents.models), efforts=COALESCE(excluded.efforts, machine_agents.efforts)`,
      )
      .bind(body.machineId, a.kind, a.installed ? 1 : 0, a.version, a.acp ? 1 : 0, a.note, t, a.models?.length ? JSON.stringify(a.models) : null, a.efforts?.length ? JSON.stringify(a.efforts) : null)
      .run();
    // 探测结果：成功则记录时间并结清刷新请求；失败则结清请求并记下原因，页面据此提示
    if (a.models?.length) {
      await db.prepare(`UPDATE machine_agents SET models_at=?, probe_requested_at=NULL, probe_error=NULL WHERE machine_id=? AND kind=?`).bind(t, body.machineId, a.kind).run();
    } else if (a.probeError) {
      await db.prepare(`UPDATE machine_agents SET probe_requested_at=NULL, probe_error=? WHERE machine_id=? AND kind=?`).bind(a.probeError.slice(0, 200), body.machineId, a.kind).run();
    }
  }
  if (body.claudeSessions) {
    await db.prepare(`DELETE FROM daemon_claude_sessions WHERE machine_id=?`).bind(body.machineId).run();
    for (const s of body.claudeSessions) {
      await db
        .prepare(
          `INSERT INTO daemon_claude_sessions (machine_id, session_id, cwd, title, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (machine_id, session_id) DO UPDATE SET cwd=excluded.cwd, title=excluded.title, updated_at=excluded.updated_at`,
        )
        .bind(body.machineId, s.id, s.cwd, s.title, Math.floor(s.updatedAt))
        .run();
    }
  }
}

export async function listMachines(db: Db, spaceId?: string, userId?: string | null): Promise<MachineView[]> {
  const machines = (
    await db
      .prepare(
        userId !== undefined
          ? `SELECT m.*, s.shared FROM machines m LEFT JOIN space_machines s ON s.machine_id=m.id AND s.space_id=? WHERE m.owner_user_id=? OR s.shared=1 ORDER BY m.name`
          : spaceId ? `SELECT m.*, s.shared FROM machines m JOIN space_machines s ON s.machine_id=m.id AND s.space_id=? ORDER BY m.name`
          : `SELECT *, 0 AS shared FROM machines ORDER BY name`,
      )
      .bind(...(userId !== undefined ? [spaceId ?? "", userId] : spaceId ? [spaceId] : []))
      .all<{ id: string; name: string; os: string | null; version: string | null; last_seen: number; owner_user_id: string | null; shared: number; legacy_auth: number }>()
  ).results;
  const agents = (await db.prepare(`SELECT machine_id, kind, installed, version, acp, note, detected_at, models, efforts, models_at, probe_requested_at, probe_error, default_model, default_effort FROM machine_agents ORDER BY machine_id, kind`).all<Record<string, unknown>>()).results;
  const t = now();
  return machines.map((m) => ({
    id: m.id,
    name: m.name,
    os: m.os,
    version: m.version,
    lastSeen: m.last_seen,
    online: isOnline(m.last_seen, t),
    ownerId: m.owner_user_id,
    owned: !!userId && m.owner_user_id === userId,
    shared: !!m.shared,
    legacyAuth: !!m.legacy_auth,
    agents: agents
      .filter((a) => a.machine_id === m.id)
      .map((a) => ({
        kind: String(a.kind),
        installed: !!a.installed,
        version: (a.version as string | null) ?? null,
        acp: !!a.acp,
        note: (a.note as string | null) ?? null,
        detectedAt: Number(a.detected_at),
        models: parseChoices(a.models),
        efforts: parseChoices(a.efforts),
        modelsAt: a.models_at == null ? null : Number(a.models_at),
        probePending: a.probe_requested_at != null,
        probeError: (a.probe_error as string | null) ?? null,
        defaultModel: (a.default_model as string | null) ?? null,
        defaultEffort: (a.default_effort as string | null) ?? null,
      })),
  }));
}

/**
 * 删除一台机器的登记（机器、智能体清单、本机 Claude 会话列表）。
 * 只允许删：离线的、没有项目绑定（含已归档项目）、没有未结束任务的机器。
 * 守护进程之后再连上来会重新登记，所以要彻底移除请先停掉那台机器上的守护进程。
 */
export async function deleteMachine(db: Db, machineId: string): Promise<{ ok: boolean; error?: string }> {
  const m = await db.prepare(`SELECT last_seen FROM machines WHERE id=?`).bind(machineId).first<{ last_seen: number }>();
  if (!m) return { ok: false, error: "机器不存在" };
  if (isOnline(m.last_seen, now())) return { ok: false, error: "机器在线，守护进程还在运行；请先停掉它再删除" };
  const p = await db.prepare(`SELECT p.name FROM projects p JOIN project_machines b ON b.project_id=p.id WHERE b.machine_id=? LIMIT 1`).bind(machineId).first<{ name: string }>();
  if (p) return { ok: false, error: `项目“${p.name}”还绑定在这台机器上，请先在项目设置里换一台机器` };
  const t = await db.prepare(`SELECT id FROM tasks WHERE machine_id=? AND stage NOT IN ('published', 'rejected', 'failed', 'cancelled') LIMIT 1`).bind(machineId).first<{ id: string }>();
  if (t) return { ok: false, error: "还有未结束的任务属于这台机器，请先取消或等它们完成" };
  try { await db.batch([
    routingLock(db),
    db.prepare(`SELECT 1 / CASE WHEN EXISTS(SELECT 1 FROM machines m WHERE m.id=? AND m.last_seen<=?)
      AND NOT EXISTS(SELECT 1 FROM project_machines WHERE machine_id=?)
      AND NOT EXISTS(SELECT 1 FROM projects WHERE machine_id=?)
      AND NOT EXISTS(SELECT 1 FROM tasks WHERE machine_id=? AND stage NOT IN ('published','rejected','failed','cancelled'))
      THEN 1 ELSE 0 END`).bind(machineId,now()-ONLINE_MS,machineId,machineId,machineId),
    db.prepare(`DELETE FROM machine_pairings WHERE machine_id=?`).bind(machineId),
    db.prepare(`DELETE FROM leases WHERE daemon_id=?`).bind(machineId),
    db.prepare(`DELETE FROM machine_agents WHERE machine_id=?`).bind(machineId),
    db.prepare(`DELETE FROM daemon_claude_sessions WHERE machine_id=?`).bind(machineId),
    db.prepare(`DELETE FROM space_machines WHERE machine_id=?`).bind(machineId),
    db.prepare(`DELETE FROM machines WHERE id=?`).bind(machineId),
  ]); } catch(error) {
    if(error instanceof Error && /division by zero/.test(error.message))return {ok:false,error:"机器状态或项目绑定已经变化，请刷新之后重试"};
    throw error;
  }
  return { ok: true };
}

/** 项目绑定的校验：机器存在，且这台机器上该智能体已安装并且能被驱动。返回错误说明，合法返回 null。 */
export async function validateBinding(db: Db, machineId: string, agent: string): Promise<string | null> {
  const m = await db.prepare(`SELECT id FROM machines WHERE id=?`).bind(machineId).first();
  if (!m) return `机器 ${machineId} 不存在（还没有守护进程注册过这个机器 ID）`;
  const a = await db.prepare(`SELECT installed, acp FROM machine_agents WHERE machine_id=? AND kind=?`).bind(machineId, agent).first<{ installed: number; acp: number }>();
  if (!a || !a.installed) return `机器 ${machineId} 上没有安装 ${agent}`;
  if (!a.acp) return `机器 ${machineId} 上的 ${agent} 暂不能被驱动`;
  return null;
}

function parseChoices(raw: unknown): Choice[] {
  if (typeof raw !== "string" || !raw) return [];
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.filter((c): c is Choice => !!c && typeof (c as Choice).value === "string").map((c) => ({ value: c.value, name: String(c.name ?? c.value) })) : [];
  } catch {
    return [];
  }
}

/** 模型与思考程度的校验：已探测到列表时，必须在该智能体自己的列表里（各家取值不同：pi 是 low/high，dsh 是 off/low/high/max）；还没探测到时，思考程度退回约定值，模型放行。 */
export async function validateModelEffort(db: Db, machineId: string, agent: string, model: string | null | undefined, effort: string | null | undefined): Promise<string | null> {
  if (!model && !effort) return null;
  const row = await db.prepare(`SELECT models, efforts FROM machine_agents WHERE machine_id=? AND kind=?`).bind(machineId, agent).first<{ models: string | null; efforts: string | null }>();
  if (effort) {
    const allowed = parseChoices(row?.efforts).map((c) => c.value);
    const list = allowed.length ? allowed : [...EFFORTS];
    if (!list.includes(effort)) return `思考程度必须是 ${list.join("、")} 之一`;
  }
  if (model) {
    const known = parseChoices(row?.models);
    if (known.length && !known.some((c) => c.value === model)) return `机器 ${machineId} 上的 ${agent} 没有模型 ${model}`;
  }
  return null;
}

/** 请求这台机器重新探测某个智能体的可选模型；守护进程在下一次与网关同步时拿到 */
export async function requestProbe(db: Db, machineId: string, agent: string): Promise<string | null> {
  const a = await db.prepare(`SELECT installed, acp FROM machine_agents WHERE machine_id=? AND kind=?`).bind(machineId, agent).first<{ installed: number; acp: number }>();
  if (!a || !a.installed || !a.acp) return `机器 ${machineId} 上的 ${agent} 不可用`;
  await db.prepare(`UPDATE machine_agents SET probe_requested_at=?, probe_error=NULL WHERE machine_id=? AND kind=?`).bind(now(), machineId, agent).run();
  return null;
}

/** 这台机器上待处理的刷新请求（智能体 ID 列表） */
export async function pendingProbes(db: Db, machineId: string): Promise<string[]> {
  return (await db.prepare(`SELECT kind FROM machine_agents WHERE machine_id=? AND probe_requested_at IS NOT NULL`).bind(machineId).all<{ kind: string }>()).results.map((r) => r.kind);
}

/** 智能体配置：这台机器上该智能体的默认模型与思考程度。之后创建的任务使用它；已创建的任务不受影响。 */
export async function setAgentConfig(db: Db, machineId: string, agent: string, cfg: { model?: string | null; effort?: string | null }): Promise<string | null> {
  const row = await db.prepare(`SELECT installed, acp FROM machine_agents WHERE machine_id=? AND kind=?`).bind(machineId, agent).first<{ installed: number; acp: number }>();
  if (!row) return `机器 ${machineId} 上没有智能体 ${agent}`;
  const model = cfg.model || null;
  const effort = cfg.effort || null;
  const err = await validateModelEffort(db, machineId, agent, model, effort);
  if (err) return err;
  await db.prepare(`UPDATE machine_agents SET default_model=?, default_effort=? WHERE machine_id=? AND kind=?`).bind(model, effort, machineId, agent).run();
  return null;
}

/** 创建任务时取这个智能体当前配置的模型与思考程度 */
export async function getAgentConfig(db: Db, machineId: string, agent: string): Promise<{ model: string | null; effort: string | null }> {
  const r = await db.prepare(`SELECT default_model, default_effort FROM machine_agents WHERE machine_id=? AND kind=?`).bind(machineId, agent).first<{ default_model: string | null; default_effort: string | null }>();
  return { model: r?.default_model ?? null, effort: r?.default_effort ?? null };
}
