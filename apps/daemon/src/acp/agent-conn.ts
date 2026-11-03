// 一个 ACP 智能体连接：独立进程组启动子进程，封装新建/加载/提示/取消/关闭。
// 取消与关闭都会杀整个进程组（P-2、P-3），避免孙进程残留。
import { spawn, type ChildProcess } from "node:child_process";
import { Readable, Writable } from "node:stream";
import * as acp from "@agentclientprotocol/sdk";

export interface AgentSpec {
  kind: string;
  command: string;
  args: string[];
  /** 启动前要去掉的环境变量（P-7：grok 经代理会 502） */
  stripEnv?: string[];
  /** 新会话后切换到的模式；为空则不切换 */
  mode?: string;
  /** 额外的环境变量（如 dsh 的免审批开关），覆盖继承的同名变量 */
  env?: Record<string, string>;
  /** 智能体无法用启动参数/模式免审批时（opencode 的 acp 子命令），守护进程对它的每个权限请求都选“仅这一次允许” */
  autoApprove?: boolean;
}

/** initialize 返回的、守护进程关心的能力 */
export interface AgentCaps {
  loadSession: boolean;
  resumeSession: boolean;
}

export type PermissionAnswer = { optionId: string } | "cancelled";

export interface OpenOptions {
  cwd: string;
  onUpdate: (sessionId: string, update: acp.SessionUpdate) => void;
  onPermission: (params: acp.RequestPermissionRequest) => Promise<PermissionAnswer>;
}

const KILL_GRACE_MS = 3000;

export class AgentConn {
  private cx!: acp.ClientContext;
  private readonly replaying = new Set<string>();
  private exitCode: number | null = null;
  private exitSignal: NodeJS.Signals | null = null;
  private alive = true;
  private resolveExit!: () => void;
  readonly exited = new Promise<void>((r) => (this.resolveExit = r));
  readonly pid: number | undefined;
  caps: AgentCaps = { loadSession: false, resumeSession: false };

  private readonly child: ChildProcess;
  /** 智能体 stderr 的尾部（最多 4KB） */
  stderrBuf = "";

  private constructor(child: ChildProcess) {
    this.child = child;
    this.pid = child.pid;
  }

  static async open(spec: AgentSpec, opts: OpenOptions): Promise<AgentConn> {
    const env = { ...process.env, ...spec.env };
    for (const k of spec.stripEnv ?? []) delete env[k];
    // detached：让智能体自成进程组，取消时可整组终止
    const child = spawn(spec.command, spec.args, { cwd: opts.cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    const conn = new AgentConn(child);
    // stderr 只保留尾部，供退出或卡住时诊断（之前直接丢弃，无法排查）
    child.stderr?.on("data", (d: Buffer) => {
      conn.stderrBuf = (conn.stderrBuf + d.toString()).slice(-4096);
    });
    const stream = acp.ndJsonStream(
      Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
      Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>,
    );
    const ready = new Promise<void>((resolve, reject) => {
      child.on("error", reject);
      conn.exited.then(() => reject(new Error(`智能体进程在就绪前退出（code=${conn.exitCode}）`)));
      const app = acp.client({ name: "loopd" })
        .onRequest("session/request_permission", async ({ params }) => {
          const r = await opts.onPermission(params);
          return r === "cancelled" ? { outcome: { outcome: "cancelled" } } : { outcome: { outcome: "selected", optionId: r.optionId } };
        })
        .onNotification("session/update", ({ params }) => {
          // 恢复时的历史重放已经落盘过，这里丢弃（P-19）
          if (conn.replaying.has(params.sessionId)) return;
          opts.onUpdate(params.sessionId, params.update);
        });
      app
        .connectWith(stream, async (cx) => {
          conn.cx = cx;
          resolve();
          await conn.exited;
        })
        .catch(() => undefined);
    });
    child.on("exit", (code, signal) => {
      conn.alive = false;
      conn.exitCode = code;
      conn.exitSignal = signal;
      conn.resolveExit();
    });
    await ready;
    const init = (await conn.cx.request("initialize", { protocolVersion: 1, clientCapabilities: {} })) as {
      agentCapabilities?: { loadSession?: boolean; sessionCapabilities?: { resume?: unknown } };
    };
    conn.caps = { loadSession: init.agentCapabilities?.loadSession === true, resumeSession: !!init.agentCapabilities?.sessionCapabilities?.resume };
    return conn;
  }

  get isAlive(): boolean {
    return this.alive;
  }

  get exitInfo(): { code: number | null; signal: NodeJS.Signals | null } {
    return { code: this.exitCode, signal: this.exitSignal };
  }

  async newSession(cwd: string, mode?: string): Promise<{ sessionId: string; configOptions?: unknown[] }> {
    const res = await this.cx.request("session/new", { cwd, mcpServers: [] });
    if (mode) await this.cx.request("session/set_mode", { sessionId: res.sessionId, modeId: mode }).catch(() => undefined);
    return { sessionId: res.sessionId, configOptions: (res as { configOptions?: unknown[] }).configOptions };
  }

  /** 设置一个会话配置项（模型、思考程度等），返回设置后的全部选项 */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<any[] | undefined> {
    const res = await this.cx.request("session/set_config_option", { sessionId, configId, value });
    return (res as { configOptions?: any[] }).configOptions;
  }

  async loadSession(sessionId: string, cwd: string): Promise<void> {
    this.replaying.add(sessionId);
    try {
      await this.cx.request("session/load", { sessionId, cwd, mcpServers: [] });
    } finally {
      this.replaying.delete(sessionId);
    }
  }

  /** 恢复旧会话：优先 session/load（会重放历史，已过滤）；只支持 session/resume 的智能体（dsh）走后者，它不重放 */
  async restoreSession(sessionId: string, cwd: string): Promise<void> {
    if (this.caps.loadSession || !this.caps.resumeSession) return this.loadSession(sessionId, cwd);
    await this.cx.request("session/resume", { sessionId, cwd, mcpServers: [] });
  }

  /** 发送一轮 prompt，返回 stopReason */
  async prompt(sessionId: string, text: string): Promise<string> {
    const res = await this.cx.request("session/prompt", { sessionId, prompt: [{ type: "text", text }] });
    return res.stopReason;
  }

  /** 请求取消当前轮；真正的收尾由调用方在超时后调用 close() */
  async cancel(sessionId: string): Promise<void> {
    await this.cx.notify("session/cancel", { sessionId });
  }

  /** 整组结束：先 SIGTERM，超时后 SIGKILL */
  async close(): Promise<void> {
    if (!this.alive || this.pid === undefined) return this.exited;
    this.signalGroup("SIGTERM");
    const t = setTimeout(() => this.signalGroup("SIGKILL"), KILL_GRACE_MS);
    await this.exited;
    clearTimeout(t);
    // 组内可能还有残留孙进程：收尾时再发一次，忽略已不存在的错误
    this.signalGroup("SIGKILL");
  }

  private signalGroup(sig: NodeJS.Signals): void {
    try {
      process.kill(-this.pid!, sig);
    } catch {
      // 组已不存在
    }
  }
}
