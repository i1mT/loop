// 守护进程控制器：串起 worktree、智能体连接、权限策略、事件落盘与恢复。
// 对外只暴露任务级操作：start / answer / cancel / reply / resume / recover。
import { EventEmitter } from "node:events";
import { randomUUID } from "node:crypto";
import { mapAcpUpdate } from "@loop/core";
import type * as acp from "@agentclientprotocol/sdk";
import {
  AgentConn,
  type AgentSpec,
  type PermissionAnswer,
} from "./acp/agent-conn.ts";
import { BUILTIN_SPECS } from "./agents.ts";
import { decide } from "./policy.ts";
import { applyModelConfig, type ConfigOption } from "./agent-options.ts";
import { SessionStore, type SessionMeta, type SessionState } from "./store.ts";
import {
  createWorktree,
  diffAgainstBase,
  syncWithMain,
  type Worktree,
} from "./worktree.ts";

const TERMINAL_OR_WAITING: SessionState[] = [
  "idle",
  "needs_you",
  "cancelled",
  "crashed",
  "failed",
  "ended",
];
const CANCEL_GRACE_MS = 2000;
const EXIT_SETTLE_MS = 300;

interface Live {
  conn: AgentConn;
  wt: Worktree;
  pending: Map<string, (a: PermissionAnswer) => void>;
  cancelRequested: boolean;
  closing: boolean;
  turn: Promise<void> | null;
  queue: string[];
  /** 本轮是否收到过智能体的消息/思考/工具调用（pi-acp 等会把模型报错吞掉，表现为空的 end_turn） */
  turnOutput: boolean;
}

export interface DaemonOptions {
  dataDir: string;
  specs?: Record<string, AgentSpec>;
}

export interface StartInput {
  taskId: string;
  /** 分支与目录名的基础（分支为 loop/<branchName>），默认任务 ID */
  branchName?: string;
  repo: string;
  agent: string;
  prompt: string;
  analysisOnly?: boolean;
  mainRef?: string;
  /** 模型与思考程度（空表示智能体默认） */
  model?: string | null;
  effort?: string | null;
}

export class LoopDaemon extends EventEmitter {
  readonly store: SessionStore;
  private readonly specs: Record<string, AgentSpec>;
  private readonly live = new Map<string, Live>();
  private readonly dataDir: string;

  constructor(opts: DaemonOptions) {
    super();
    this.dataDir = opts.dataDir;
    this.store = new SessionStore(opts.dataDir);
    this.specs = { ...BUILTIN_SPECS, ...(opts.specs ?? {}) };
  }

  spec(kind: string): AgentSpec {
    const s = this.specs[kind];
    if (!s) throw new Error(`未知的智能体：${kind}`);
    return s;
  }

  /** 新建任务：建 worktree、写策略、开会话并开始第一轮。返回会话 ID（轮次在后台进行）。 */
  async start(input: StartInput): Promise<string> {
    const mainRef = input.mainRef ?? "main";
    const spec = this.spec(input.agent);
    const wt = await createWorktree({
      repo: input.repo,
      dataDir: this.dataDir,
      taskId: input.taskId,
      mainRef,
      name: input.branchName,
    });
    const meta = this.store.createSession({
      id: randomUUID(),
      taskId: input.taskId,
      agent: input.agent,
      cwd: wt.path,
      repo: input.repo,
      mainRef,
      branch: wt.branch,
      base: wt.base,
      analysisOnly: input.analysisOnly,
      model: input.model ?? null,
      effort: input.effort ?? null,
    });
    const conn = await this.open(meta.id, spec, wt);
    const { sessionId, configOptions } = await conn.newSession(
      wt.path,
      spec.mode,
    );
    this.store.updateMeta(meta.id, { externalId: sessionId });
    await this.applyConfig(
      meta.id,
      conn,
      sessionId,
      configOptions as ConfigOption[] | undefined,
      input,
    );
    this.setState(meta.id, "running");
    this.enqueueTurn(meta.id, input.prompt);
    return meta.id;
  }

  /** 应用模型与思考程度；结果（含无法应用的说明）记入会话，页面的活动里可见 */
  private async applyConfig(
    id: string,
    conn: AgentConn,
    sessionId: string,
    options: ConfigOption[] | undefined,
    req: { model?: string | null; effort?: string | null },
    record = true,
  ): Promise<void> {
    if (!req.model && !req.effort) return;
    const notes = await applyModelConfig(conn, sessionId, options, req);
    // 恢复会话时不记录：此时追加状态事件会让任务阶段误跳
    if (record && notes.length)
      this.store.append(id, {
        kind: "status",
        payload: { state: "running", detail: notes.join("；") },
      });
  }

  private async open(
    id: string,
    spec: AgentSpec,
    wt: Worktree,
  ): Promise<AgentConn> {
    const conn = await AgentConn.open(spec, {
      cwd: wt.path,
      onUpdate: (_sid, u) => this.onUpdate(id, u),
      onPermission: (p) => this.onPermission(id, p),
    });
    const live: Live = {
      conn,
      wt,
      pending: new Map(),
      cancelRequested: false,
      closing: false,
      turn: null,
      queue: [],
      turnOutput: false,
    };
    this.live.set(id, live);
    conn.exited.then(() => this.onExit(id));
    return conn;
  }

  private onUpdate(id: string, u: acp.SessionUpdate): void {
    const live = this.live.get(id);
    if (
      live &&
      ["agent_message_chunk", "agent_thought_chunk", "tool_call"].includes(
        (u as { sessionUpdate: string }).sessionUpdate,
      )
    )
      live.turnOutput = true;
    const meta = this.store.getMeta(id);
    if (
      meta?.planContinuation?.status === "pending" &&
      ["agent_message_chunk", "tool_call"].includes(
        (u as { sessionUpdate: string }).sessionUpdate,
      )
    )
      this.store.updateMeta(id, {
        planContinuation: { ...meta.planContinuation, status: "delivered" },
      });
    const m = mapAcpUpdate(
      u as unknown as { sessionUpdate: string; [k: string]: unknown },
    );
    if (!m) return;
    this.store.append(id, m);
  }

  /** 权限：策略直接放行，或升级为 needs_you 并挂起，直到人作出回答 */
  private async onPermission(
    id: string,
    p: acp.RequestPermissionRequest,
  ): Promise<PermissionAnswer> {
    const live = this.live.get(id);
    if (!live) return "cancelled";
    const meta = this.store.getMeta(id)!;
    const requestId = p.toolCall.toolCallId;
    const options = p.options.map((o) => ({
      optionId: o.optionId,
      name: o.name,
      kind: o.kind,
    }));
    const d = this.spec(meta.agent).autoApprove
      ? ({ action: "allow" } as const)
      : decide({ toolCall: p.toolCall as never }, meta.cwd);
    if (d.action === "allow") {
      const allow = options.find((o) => o.kind === "allow_once");
      if (!allow) return "cancelled";
      this.store.append(id, {
        kind: "permission_resolved",
        payload: { requestId, optionId: allow.optionId, decidedBy: "policy" },
      });
      return { optionId: allow.optionId };
    }
    this.store.append(id, {
      kind: "permission_request",
      payload: {
        requestId,
        title: p.toolCall.title ?? "操作",
        toolKind: p.toolCall.kind ?? undefined,
        options,
      },
    });
    this.store.append(id, {
      kind: "needs_you",
      payload: {
        reason: "rule:permission",
        question: `${p.toolCall.title ?? "一个操作"}：${d.reason}。是否允许？`,
        options: options.map((o) => ({ id: o.optionId, label: o.name })),
      },
    });
    // 先登记等待项，再改状态：状态事件的监听者可能立刻回答
    const answered = new Promise<PermissionAnswer>((resolve) =>
      live.pending.set(requestId, resolve),
    );
    this.setState(id, "needs_you");
    return answered;
  }

  /** 人对权限请求作出回答 */
  answer(id: string, requestId: string, optionId: string): void {
    const live = this.live.get(id);
    const resolve = live?.pending.get(requestId);
    if (!live || !resolve)
      throw new Error(`没有等待中的权限请求：${requestId}`);
    live.pending.delete(requestId);
    this.store.append(id, {
      kind: "permission_resolved",
      payload: { requestId, optionId, decidedBy: "human" },
    });
    resolve({ optionId });
    if (live.pending.size === 0) this.setState(id, "running");
  }

  /** 发送用户消息：会话空闲时立即开始新一轮，否则排队到本轮结束后执行 */
  reply(id: string, text: string): void {
    const live = this.live.get(id);
    if (!live) throw new Error("会话没有在运行，请先 resume");
    if (live.turn) {
      live.queue.push(text);
      return;
    }
    this.enqueueTurn(id, text);
  }

  private enqueueTurn(id: string, text: string): void {
    const live = this.live.get(id)!;
    this.setState(id, "running");
    live.turn = this.runTurn(id, text).finally(() => {
      live.turn = null;
      const next = live.queue.shift();
      if (next !== undefined && this.live.has(id)) this.enqueueTurn(id, next);
    });
  }

  private async runTurn(id: string, text: string): Promise<void> {
    const live = this.live.get(id);
    const meta = this.store.getMeta(id);
    if (!live || !meta?.externalId) return;
    this.store.append(id, { kind: "message", payload: { role: "user", text } });
    live.turnOutput = false;
    try {
      const stop = await live.conn.prompt(meta.externalId, text);
      const reason = normalizeStop(stop, live.cancelRequested);
      if (reason === "end_turn" && !live.turnOutput && !live.cancelRequested) {
        // 没有任何输出就正常结束：多半是模型调用失败被适配器吞掉（如凭证无效），不能当作“做完了”
        this.store.append(id, {
          kind: "error",
          payload: {
            message: `智能体没有产生任何输出就结束了（常见原因：模型凭证无效或服务不可用）。${live.conn.stderrBuf.trim().slice(-200)}`,
            fatal: false,
          },
        });
        this.setState(id, "failed");
        return;
      }
      this.store.append(id, { kind: "stop", payload: { stopReason: reason } });
      this.store.updateMeta(id, { stopReason: reason });
    } catch (e) {
      // 连接断开的错误可能先于进程 exit 事件到达：先等一小段时间让退出事件落地，再归类
      await Promise.race([
        live.conn.exited,
        new Promise((r) => setTimeout(r, EXIT_SETTLE_MS)),
      ]);
      if (live.closing || live.cancelRequested || !live.conn.isAlive) return; // 崩溃与关闭由 onExit / close 处理
      this.store.append(id, {
        kind: "error",
        payload: { message: (e as Error).message, fatal: false },
      });
      this.setState(id, "failed");
      return;
    }
    if (!live.conn.isAlive) return;
    await this.finalize(id);
  }

  /** 一轮结束后：计算文件级 diff（P-16），同步主分支（P-17 以 git 为准） */
  private async finalize(id: string): Promise<void> {
    const live = this.live.get(id);
    const meta = this.store.getMeta(id);
    if (!live || !meta) return;
    if (live.cancelRequested) {
      this.setState(id, "cancelled");
      return;
    }
    for (const f of await diffAgainstBase(live.wt)) {
      this.store.append(id, {
        kind: "diff",
        payload: { path: f.path, change: f.change, patch: f.patch },
      });
    }
    if (live.pending.size > 0) return; // 仍在等人，状态已是 needs_you
    if (meta.analysisOnly) {
      this.setState(id, "idle");
      return;
    }
    if (meta.planContinuation && meta.planContinuation.status !== "completed")
      this.store.updateMeta(id, {
        planContinuation: {
          ...meta.planContinuation,
          status: "completed",
          recoveryRequired: false,
        },
      });
    const sync = await syncWithMain(live.wt, meta.repo, meta.mainRef);
    if (sync.state === "conflict") {
      this.store.append(id, {
        kind: "needs_you",
        payload: {
          reason: "rule:main-moved",
          question: `主分支 ${meta.mainRef} 已前进，自动同步冲突（${sync.detail}）。要怎么处理？`,
          options: [
            { id: "retry", label: "我已处理冲突，重试同步" },
            { id: "abandon", label: "放弃这次改动" },
          ],
        },
      });
      this.setState(id, "needs_you");
      return;
    }
    if (sync.state === "merged") {
      this.store.append(id, {
        kind: "status",
        payload: {
          state: "running",
          detail: `已自动同步到最新 ${meta.mainRef}（${sync.head.slice(0, 8)}）`,
        },
      });
    }
    this.setState(id, "idle");
  }

  /** 回答 rule:main-moved 类的人工介入 */
  async resolveNeedsYou(id: string, optionId: string): Promise<void> {
    const meta = this.store.getMeta(id);
    const live = this.live.get(id);
    if (!meta || !live) throw new Error("会话没有在运行");
    if (meta.state !== "needs_you")
      throw new Error(`会话当前不在等待决定（${meta.state}），忽略这次决定`);
    this.store.append(id, {
      kind: "status",
      payload: { state: "running", detail: `人工决定：${optionId}` },
    });
    if (optionId === "abandon") {
      await this.cancel(id);
      return;
    }
    if (optionId === "wait") {
      this.setState(id, "running");
      return;
    }
    const sync = await syncWithMain(live.wt, meta.repo, meta.mainRef);
    if (sync.state === "conflict") {
      this.store.append(id, {
        kind: "needs_you",
        payload: {
          reason: "rule:main-moved",
          question: `仍然冲突（${sync.detail}）`,
          options: [
            { id: "retry", label: "再次重试" },
            { id: "abandon", label: "放弃" },
          ],
        },
      });
      this.setState(id, "needs_you");
      return;
    }
    this.setState(id, "idle");
  }

  /** 取消：先通知智能体收尾，超时后整组结束（P-2、P-3） */
  /**
   * 取消会话。local=true 用于“租约丢了，先停手”：只改本地状态，不写“已取消”事件——
   * 否则租约恢复后重新接管时，这条过期的事件会被转发到网关，把还在待审核的任务取消掉。
   */
  async cancel(id: string, opts: { local?: boolean } = {}): Promise<void> {
    const live = this.live.get(id);
    const meta = this.store.getMeta(id);
    if (!live || !meta?.externalId) return;
    live.cancelRequested = true;
    for (const [rid, resolve] of live.pending) {
      live.pending.delete(rid);
      resolve("cancelled");
    }
    await live.conn.cancel(meta.externalId).catch(() => undefined);
    const turn = live.turn;
    await Promise.race([
      turn ?? Promise.resolve(),
      new Promise((r) => setTimeout(r, CANCEL_GRACE_MS)),
    ]);
    live.closing = true;
    await live.conn.close();
    this.live.delete(id);
    if (opts.local) {
      this.store.updateMeta(id, { state: "cancelled" });
      setImmediate(() => this.emit("state", id));
    } else this.setState(id, "cancelled");
  }

  private onExit(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    if (live.closing) return; // 主动关闭：状态由调用方设置
    this.live.delete(id);
    for (const resolve of live.pending.values()) resolve("cancelled");
    const err = live.conn.stderrBuf.trim().slice(-300);
    this.store.append(id, {
      kind: "status",
      payload: {
        state: "crashed",
        detail: `智能体进程退出（${live.conn.exitInfo.code ?? live.conn.exitInfo.signal}）${err ? `：${err}` : ""}`,
      },
    });
    const interrupted = this.store.getMeta(id)?.planContinuation;
    this.store.updateMeta(id, {
      state: "crashed",
      ...(interrupted && interrupted.status !== "completed"
        ? { planContinuation: { ...interrupted, recoveryRequired: true } }
        : {}),
    });
    setImmediate(() => this.emit("state", id));
  }

  /** 恢复：新进程加载旧会话（P-19 重放已过滤），状态回到 idle */
  async resume(id: string): Promise<void> {
    const meta = this.store.getMeta(id);
    if (!meta?.externalId) throw new Error("该会话没有可恢复的智能体会话");
    if (this.live.has(id)) return;
    const wt: Worktree = {
      path: meta.cwd,
      branch: meta.branch,
      base: meta.base,
    };
    const conn = await this.open(id, this.spec(meta.agent), wt);
    await conn.restoreSession(meta.externalId, meta.cwd);
    await this.applyConfig(
      id,
      conn,
      meta.externalId,
      undefined,
      { model: meta.model, effort: meta.effort },
      false,
    );
    // 崩溃或等待中的会话：原来的权限请求已经丢失，恢复后仍需人回复才能继续
    if (meta.state === "needs_you" || meta.state === "crashed")
      this.setState(id, "needs_you", "恢复后等待你的回复");
    else this.setState(id, "idle", "已恢复");
  }

  /** 人明确要求重试发布：清除重启留下的 crashed/needs_you，让发布会话从空闲开始。 */
  resetForPublish(id: string): void {
    if (!this.store.getMeta(id)) return;
    this.setState(id, "idle", "发布重试：已清除上次中断留下的等待状态");
  }

  /** 启动时调用：上次还在运行的会话标记为 crashed，等待 resume */
  recover(): string[] {
    const ids: string[] = [];
    for (const m of this.store.listMetas()) {
      if (
        !["starting", "running", "needs_you"].includes(m.state) ||
        this.live.has(m.id)
      )
        continue;
      this.store.append(m.id, {
        kind: "status",
        payload: { state: "crashed", detail: "守护进程重启前会话未结束" },
      });
      this.store.updateMeta(m.id, {
        state: "crashed",
        ...(m.planContinuation && m.planContinuation.status !== "completed"
          ? {
              planContinuation: {
                ...m.planContinuation,
                recoveryRequired: true,
              },
            }
          : {}),
      });
      ids.push(m.id);
    }
    return ids;
  }

  /** 等待会话进入可交互状态（空闲、等人、结束等） */
  waitFor(
    id: string,
    states: SessionState[] = TERMINAL_OR_WAITING,
    timeoutMs = 30000,
  ): Promise<SessionMeta> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const m = this.store.getMeta(id)!;
        if (states.includes(m.state)) {
          this.off("state", onState);
          clearTimeout(timer);
          resolve(m);
          return true;
        }
        return false;
      };
      const onState = (sid: string) => {
        if (sid === id) check();
      };
      const timer = setTimeout(() => {
        this.off("state", onState);
        reject(
          new Error(
            `等待会话 ${id} 状态超时（当前 ${this.store.getMeta(id)?.state}）`,
          ),
        );
      }, timeoutMs);
      this.on("state", onState);
      check();
    });
  }

  private setState(id: string, state: SessionState, detail?: string): void {
    this.store.updateMeta(id, { state });
    this.store.append(id, {
      kind: "status",
      payload: { state, ...(detail ? { detail } : {}) },
    });
    // 异步派发：监听者的代码不得打断状态迁移的关键路径
    setImmediate(() => this.emit("state", id));
  }

  isLive(id: string): boolean {
    return this.live.has(id);
  }

  /**
   * 卡住升级：运行中且超过 idleMs 没有新事件、也没有等待中的权限，就升级为"需要你"。
   * 只升级一次（直到下一次有事件）。返回是否升级了。
   */
  escalateIfStalled(id: string, idleMs: number): boolean {
    const live = this.live.get(id);
    const m = this.store.getMeta(id);
    if (!live || !m || m.state !== "running" || live.pending.size > 0)
      return false;
    const last = this.store.read(id).slice(-1)[0];
    if (!last || Date.now() - last.at < idleMs) return false;
    const already = this.store.read(id).slice(-1)[0];
    if (already.kind === "needs_you") return false;
    const tail = live.conn.stderrBuf.trim().slice(-200);
    this.store.append(id, {
      kind: "needs_you",
      payload: {
        reason: "rule:stalled",
        question: `智能体已经 ${Math.round(idleMs / 60000)} 分钟没有输出${tail ? `（最后的错误输出：${tail}）` : ""}。要继续等待，还是放弃这次运行？`,
        options: [
          { id: "wait", label: "继续等待" },
          { id: "abandon", label: "放弃这次运行" },
        ],
      },
    });
    this.setState(id, "needs_you");
    return true;
  }

  async close(): Promise<void> {
    for (const [id, live] of this.live) {
      live.closing = true;
      await live.conn.close();
      this.live.delete(id);
    }
  }
}

const KNOWN_STOP = [
  "end_turn",
  "max_tokens",
  "max_turn_requests",
  "refusal",
  "cancelled",
] as const;

function normalizeStop(
  stop: string,
  cancelRequested: boolean,
): (typeof KNOWN_STOP)[number] | "unknown" {
  if (cancelRequested && stop !== "end_turn") return "cancelled";
  return (KNOWN_STOP as readonly string[]).includes(stop)
    ? (stop as (typeof KNOWN_STOP)[number])
    : "unknown";
}
