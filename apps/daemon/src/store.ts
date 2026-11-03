// 会话存储：元数据 JSON + 事件 JSONL。序号按会话内单调递增，重启后从已存的最大序号续接（P-21）。
// 写入前用 @loop/core 校验事件，非法事件拒绝写入。
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { parseSessionEvent, type SessionEvent } from "@loop/core";

export type SessionState =
  | "starting"
  | "running"
  | "idle"
  | "needs_you"
  | "cancelled"
  | "crashed"
  | "failed"
  | "ended";

export interface SessionMeta {
  id: string;
  taskId: string;
  agent: string;
  cwd: string;
  repo: string;
  mainRef: string;
  branch: string;
  base: string;
  externalId: string | null;
  /** 任务指定的模型与思考程度（空表示智能体默认） */
  model?: string | null;
  effort?: string | null;
  /** 任务第几轮（发布后继续迭代一次加一）；缺省为 1 */
  round?: number;
  /** 技术方案分析对应的任务轮次；用于阻止恢复时误用上一轮报告。 */
  planRound?: number;
  analysisOnly?: boolean;
  planResultHash?: string;
  planResultPending?: {
    round: number;
    head: string;
    markdown: string;
    pr?: { number: number; url: string } | null;
  };
  planContinuation?: {
    id: string;
    attempt: number;
    status: "pending" | "delivered" | "completed";
    eventSeq: number;
    recoveryRequired?: boolean;
  };
  state: SessionState;
  stopReason: string | null;
  createdAt: number;
  updatedAt: number;
}

export class SessionStore {
  private readonly dir: string;
  private readonly lastSeqCache = new Map<string, number>();

  constructor(dataDir: string) {
    this.dir = join(dataDir, "sessions");
    mkdirSync(this.dir, { recursive: true });
  }

  private metaPath(id: string): string {
    return join(this.dir, `${id}.meta.json`);
  }

  private eventsPath(id: string): string {
    return join(this.dir, `${id}.events.jsonl`);
  }

  createSession(
    m: Omit<
      SessionMeta,
      "createdAt" | "updatedAt" | "state" | "stopReason" | "externalId"
    > & { id: string },
  ): SessionMeta {
    const now = Date.now();
    const meta: SessionMeta = {
      ...m,
      externalId: null,
      state: "starting",
      stopReason: null,
      createdAt: now,
      updatedAt: now,
    };
    this.writeMeta(meta);
    return meta;
  }

  getMeta(id: string): SessionMeta | null {
    const p = this.metaPath(id);
    return existsSync(p)
      ? (JSON.parse(readFileSync(p, "utf8")) as SessionMeta)
      : null;
  }

  updateMeta(id: string, patch: Partial<SessionMeta>): SessionMeta {
    const cur = this.getMeta(id);
    if (!cur) throw new Error(`会话不存在：${id}`);
    const next = { ...cur, ...patch, updatedAt: Date.now() };
    this.writeMeta(next);
    return next;
  }

  listMetas(): SessionMeta[] {
    return readdirSync(this.dir)
      .filter((f) => f.endsWith(".meta.json"))
      .map(
        (f) =>
          JSON.parse(readFileSync(join(this.dir, f), "utf8")) as SessionMeta,
      );
  }

  private writeMeta(meta: SessionMeta): void {
    // 原子写：先写临时文件再重命名，崩溃时不会留下半截 JSON
    const tmp = `${this.metaPath(meta.id)}.tmp`;
    writeFileSync(tmp, JSON.stringify(meta, null, 2));
    renameSync(tmp, this.metaPath(meta.id));
  }

  lastSeq(id: string): number {
    const cached = this.lastSeqCache.get(id);
    if (cached !== undefined) return cached;
    let max = -1;
    for (const e of this.readAll(id)) max = Math.max(max, e.seq);
    this.lastSeqCache.set(id, max);
    return max;
  }

  /** 追加一条事件，序号自动分配。非法事件抛错。 */
  append(id: string, body: { kind: string; payload: unknown }): SessionEvent {
    const seq = this.lastSeq(id) + 1;
    const parsed = parseSessionEvent({
      seq,
      sessionId: id,
      at: Date.now(),
      kind: body.kind,
      payload: body.payload,
    });
    if (!parsed.ok) throw new Error(`非法事件 ${body.kind}：${parsed.error}`);
    appendFileSync(this.eventsPath(id), `${JSON.stringify(parsed.event)}\n`);
    this.lastSeqCache.set(id, seq);
    return parsed.event;
  }

  read(id: string, afterSeq = -1): SessionEvent[] {
    return this.readAll(id).filter((e) => e.seq > afterSeq);
  }

  /** 逐行解析；最后一行若是崩溃留下的半截内容，直接忽略 */
  private readAll(id: string): SessionEvent[] {
    const p = this.eventsPath(id);
    if (!existsSync(p)) return [];
    const out: SessionEvent[] = [];
    for (const line of readFileSync(p, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try {
        const r = parseSessionEvent(JSON.parse(line));
        if (r.ok) out.push(r.event);
      } catch {
        // 半截行：忽略
      }
    }
    return out;
  }
}
