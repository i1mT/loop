// loopd serve：常驻守护进程。
// - 工作：领取任务 → 在本地跑智能体 → 回传事件与当前提交 → 取回人的回复与回答
// - 发布：领取已批准的任务 → 同步主分支 → 确认仍是审核过的提交 → 以 SHA 执行发布命令 → 回传结果
// 网关只通过 HTTP 交互（docs/contracts/daemon-protocol.md）；令牌只从环境变量读取，不写入仓库。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import {
  TECHNICAL_PLAN_INSTRUCTION,
  extractTechnicalPlan,
  continuationPrompt,
  type TechnicalPlanState,
} from "./technical-plan/contract.ts";
import { LoopDaemon } from "./daemon.ts";
import type { AgentSpec } from "./acp/agent-conn.ts";
import {
  parseProjectCommands,
  type ProjectCommands,
} from "./project-commands.ts";
import { runShell } from "./shell.ts";
import { restoreWorktree, startNewRound, type Worktree } from "./worktree.ts";
import { discoverAgents, listClaudeSessions } from "./discovery.ts";
import { probeAgentOptions, type AgentOptions } from "./agent-options.ts";
import { BUILTIN_SPECS } from "./agents.ts";
import {
  parseVerdict,
  publishPrompt,
  runPublishInSession,
  syncToMergedMain,
} from "./publish-agent.ts";
import { GitHubForge, lastPrNumber, type Forge, type PrRef } from "./forge.ts";
import {
  branchBase,
  commitLeftovers,
  publishBranch,
  retireBranch,
  syncAndMerge,
  cleanupTask,
} from "./pr-flow.ts";

const PROMPT_PATH = new URL("../prompts/engineer.md", import.meta.url);
const TEST_TIMEOUT_MS = 10 * 60_000;
/** 运行中多久没有新事件就视为卡住，升级给人（毫秒） */
const STALL_MS = 5 * 60_000;
/** 没有任何任务时的轮询间隔（毫秒） */
export const IDLE_TICK_MS = 60_000;
/** 会话都在空闲等人（审核、评论）时的间隔：必须明显小于租约 60 秒，才能按时续租约 */
export const WAITING_TICK_MS = 20_000;
export const BUSY_TICK_MS = 1000;

/** 下一轮多久后开始：有会话在运行、等权限、启动中或在发布时要快；只剩空闲会话时放慢；什么都没有时最慢 */
export function nextTickMs(
  sessionStates: string[],
  publishing: boolean,
): number {
  if (publishing) return BUSY_TICK_MS;
  if (sessionStates.length === 0) return IDLE_TICK_MS;
  return sessionStates.every((s) => s === "idle")
    ? WAITING_TICK_MS
    : BUSY_TICK_MS;
}
const PUBLISH_TIMEOUT_MS = 20 * 60_000;

export const LOOPD_VERSION = "0.1.0";

export interface ServeOptions {
  gateway: string;
  token: string;
  /** 机器 ID：网关用它区分各台电脑；项目绑定到某个机器 ID，任务只被这个 ID 领取 */
  daemonId: string;
  /** 机器的显示名（默认等于机器 ID） */
  machineName?: string;
  dataDir: string;
  specs?: Record<string, AgentSpec>;
  /** 同时运行（智能体在干活）的任务上限，默认 3（LOOPD_CONCURRENCY）；等审核的空闲任务不占名额 */
  concurrency?: number;
  /** 代码托管操作（默认 GitHub，用 gh 与 git）；测试时可注入假实现 */
  forge?: Forge;
  /** 循环间隔（毫秒） */
  tickMs?: number;
  log?: (msg: string) => void;
  signal?: AbortSignal;
}

interface ActiveSession {
  leaseId: string;
  taskId: string;
  forwarded: number; // 已确认回传到的 seq
  inboxCursor: number;
  lost: boolean; // 租约被网关收回：停止写入
  reportedHead: string | null; // 已经回传过的提交
  githubRepo: string;
  mainBranch: string;
  title: string;
  body: string;
  repoDir: string;
  /** 已有的 PR（推送过之后的推送是强推） */
  pr: PrRef | null;
  /** 推送失败后的重试时间，避免每个轮询周期都重试 */
  retryAt: number;
  technicalPlan: boolean;
  round: number;
}

interface Ctx {
  d: LoopDaemon;
  gw: GatewayClient;
  daemonId: string;
  forge: Forge;
  dataDir: string;
  gateway: string;
  log: (m: string) => void;
  active: Map<string, ActiveSession>;
  publishing: Map<string, PublishLease>;
}

interface PublishLease {
  leaseId: string;
  taskId: string;
  done: boolean;
}

export class GatewayClient {
  private readonly base: string;
  private readonly token: string;

  constructor(base: string, token: string) {
    this.base = base;
    this.token = token;
  }

  async call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
  ): Promise<{ status: number; data: T }> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { ok: false, error: text.slice(0, 200) };
    }
    return { status: res.status, data: data as T };
  }
}

type Claim = {
  leaseId: string;
  task: {
    id: string;
    title: string;
    body: string;
    repoPath: string | null;
    githubRepo: string | null;
    mainRef: string;
    branch: string | null;
    model: string | null;
    effort: string | null;
    /** 项目的全局指令（项目负责人维护），任务开始时一并发给智能体 */
    instructions: string | null;
    prNumber: number | null;
    prUrl: string | null;
    agent: string;
    sessionId: string | null;
    reattach: boolean;
    job: "work" | "publish";
    approvedSha: string | null;
    /** 第几轮（发布后继续迭代一次加一）；比本机会话记录的大，说明是新一轮 */
    round?: number;
    technicalPlan?: { required: boolean; phase: string };
    attributes?: { planReview?: boolean };
  };
};

export async function serve(opts: ServeOptions): Promise<void> {
  const log =
    opts.log ??
    ((m: string) => console.log(`[loopd ${new Date().toISOString()}] ${m}`));
  const gw = new GatewayClient(opts.gateway.replace(/\/$/, ""), opts.token);
  const d = new LoopDaemon({ dataDir: opts.dataDir, specs: opts.specs });
  const concurrency =
    opts.concurrency ?? Number(process.env.LOOPD_CONCURRENCY ?? 3);
  const active = new Map<string, ActiveSession>();
  const publishing = new Map<string, PublishLease>();
  const ctx: Ctx = {
    d,
    gw,
    daemonId: opts.daemonId,
    forge: opts.forge ?? new GitHubForge(),
    dataDir: opts.dataDir,
    gateway: opts.gateway.replace(/\/$/, ""),
    log,
    active,
    publishing,
  };
  /** 正在干活的会话数（启动中或运行中）。空闲等审核的会话不占名额。 */
  const running = () =>
    [...active.keys()].filter((sid) =>
      ["running", "starting"].includes(
        d.store.getMeta(sid)?.state ?? "running",
      ),
    ).length;
  const crashed = d.recover();
  if (crashed.length)
    log(
      `重启前未结束的会话已标记为 crashed：${crashed.length} 个，等待网关重新分配`,
    );

  // 心跳独立于主循环：主循环里的推送、建 PR、测试等外部命令可能阻塞很久，不能因此让租约过期
  const retiring = new Set<string>();
  const beat = async () => {
    for (const [sid, a] of active) {
      if (a.lost) continue;
      const h = await gw
        .call<{ stage?: string }>(
          "POST",
          `/api/daemon/leases/${a.leaseId}/heartbeat`,
          { daemonId: opts.daemonId },
        )
        .catch(() => null);
      if (h?.status === 409) markLost(d, sid, a, log);
      // 人驳回或取消了任务：关闭 PR、清理 worktree、释放租约（发布中的任务由发布流程自己收尾）
      else if (
        h &&
        (h.data.stage === "rejected" || h.data.stage === "cancelled") &&
        !isPublishing(publishing, a.taskId) &&
        !retiring.has(sid)
      ) {
        retiring.add(sid);
        void retireTask(ctx, sid, a, h.data.stage).finally(() =>
          retiring.delete(sid),
        );
      } else if (
        h &&
        (h.data.stage === "failed" || h.data.stage === "published") &&
        !isPublishing(publishing, a.taskId) &&
        !retiring.has(sid)
      ) {
        // 任务已结束（会话自己失败等）：停止管理并释放租约；保留 PR 与工作树供人查看
        retiring.add(sid);
        a.lost = true;
        void ctx.d.cancel(sid, { local: true }).catch(() => undefined);
        void gw
          .call("POST", `/api/daemon/leases/${a.leaseId}/release`, {
            daemonId: opts.daemonId,
          })
          .catch(() => undefined);
        active.delete(sid);
        log(
          `任务 ${a.taskId} 已${h.data.stage === "failed" ? "失败" : "发布"}，停止管理会话 ${sid} 并释放租约`,
        );
        retiring.delete(sid);
      }
    }
    for (const p of publishing.values()) {
      if (!p.done)
        await gw
          .call("POST", `/api/daemon/leases/${p.leaseId}/heartbeat`, {
            daemonId: opts.daemonId,
          })
          .catch(() => null);
    }
  };
  const beatTimer = setInterval(() => void beat(), 15_000);
  opts.signal?.addEventListener("abort", () => clearInterval(beatTimer));
  let lastDiscovery = 0;
  let startupProbed = false;
  const agentOptions = new Map<string, AgentOptions>();
  const probeErrors = new Map<string, string>();
  const probing = new Set<string>();
  let sendHelloFn: () => Promise<unknown> = async () => undefined;
  /** 探测智能体的可选模型（开临时会话读取，不调用模型），完成后重新上报 */
  async function probeAgents(kinds: string[]): Promise<void> {
    const todo = kinds.filter((k) => !probing.has(k));
    if (!todo.length) return;
    todo.forEach((k) => probing.add(k));
    try {
      for (const kind of todo) {
        const spec = (opts.specs ?? BUILTIN_SPECS)[kind];
        const o = spec ? await probeAgentOptions(spec) : null;
        if (o) {
          agentOptions.set(kind, o);
          probeErrors.delete(kind);
        } else
          probeErrors.set(kind, "没能读取到模型列表（智能体启动失败或未登录）");
      }
      await sendHelloFn().catch(() => undefined);
      for (const k of todo) probeErrors.delete(k);
    } finally {
      todo.forEach((k) => probing.delete(k));
    }
  }
  while (!opts.signal?.aborted) {
    try {
      // 0. 本机工具发现：启动时与每 10 分钟上报一次（只读）
      if (Date.now() - lastDiscovery > 10 * 60_000) {
        lastDiscovery = Date.now();
        const agents = await discoverAgents();
        const claudeSessions = listClaudeSessions(20);
        sendHelloFn = () =>
          gw.call("POST", "/api/daemon/hello", {
            machineId: opts.daemonId,
            name: opts.machineName ?? opts.daemonId,
            os: process.platform,
            version: LOOPD_VERSION,
            // 附带各智能体可选的模型与思考程度（探测结果，可能还没有）和探测失败的原因
            agents: agents.map((a) => ({
              ...a,
              models: agentOptions.get(a.kind)?.models ?? null,
              efforts: agentOptions.get(a.kind)?.efforts ?? null,
              probeError: probeErrors.get(a.kind) ?? null,
            })),
            claudeSessions,
          });
        // 以机器身份注册并上报智能体（daemonId 就是机器 ID）
        await sendHelloFn();
        // 模型列表要开临时会话才能读到：启动后探测一次，之后只在用户点“刷新”时探测（见下面领取响应里的 probe）
        if (!startupProbed) {
          startupProbed = true;
          void probeAgents(
            agents.filter((x) => x.installed && x.acp).map((x) => x.kind),
          );
        }
      }

      // 1. 领取：工作类有空位时领；发布类随时可以领（互不占用工作位）
      {
        const r = await gw.call<{
          ok: boolean;
          claim: null | Claim;
          probe?: string[];
        }>("POST", "/api/daemon/claim", {
          daemonId: opts.daemonId,
          capabilities: { technicalPlan: true },
          holding: [
            ...[...active.values()].filter((a) => !a.lost).map((a) => a.taskId),
            ...[...publishing.values()]
              .filter((p) => !p.done)
              .map((p) => p.taskId),
          ],
        });
        const c = r.status === 200 ? r.data.claim : null;
        // 用户在页面点了“刷新模型列表”：后台探测，不阻塞领取
        if (r.status === 200 && r.data.probe?.length)
          void probeAgents(r.data.probe);
        if (c) {
          if (c.task.job === "publish") startPublish(ctx, c);
          else if (running() < concurrency || c.task.reattach)
            await startOrReattach(ctx, c);
          // 工作位已满且是新任务：不处理，租约会过期后由网关重新排队
        }
      }

      // 3. 回传事件（幂等：网关按 seq 去重）
      for (const [sid, a] of active) await forwardEvents(ctx, sid, a);

      // 4. 每轮结束后：补提交残留改动 → 提交变化时跑测试与预览 → 推送分支并建/更新 PR → 回传提交与 PR
      for (const [sid, a] of active) {
        if (
          a.lost ||
          isPublishing(publishing, a.taskId) ||
          Date.now() < a.retryAt
        )
          continue;
        const m = d.store.getMeta(sid);
        if (!m) continue;
        if (
          a.technicalPlan &&
          ["idle", "needs_you"].includes(m.state) &&
          (await handleTechnicalPlan(ctx, sid, a))
        )
          continue;
        if (m.state !== "idle") continue;
        const wt: Worktree = { path: m.cwd, branch: m.branch, base: m.base };
        await commitLeftovers(wt, `loop: ${a.title}`).catch((e) =>
          log(`补提交失败（会话 ${sid}）：${(e as Error).message}`),
        );
        const head = currentHead(m.cwd);
        if (!head || head === a.reportedHead) continue;
        if (
          a.technicalPlan &&
          m.planResultPending?.head === head &&
          m.planResultPending.round === a.round
        ) {
          await reportImplementation(ctx, sid, a, head);
          continue;
        }
        const cmds = projectCommands(m.cwd);
        if (cmds.test) {
          const r = await runShell(cmds.test, m.cwd, TEST_TIMEOUT_MS);
          d.store.append(sid, {
            kind: "check",
            payload: {
              name: "test",
              ok: r.code === 0 && !r.timedOut,
              output: tail(r.output),
            },
          });
        }
        if (cmds.preview) {
          const r = await runShell(cmds.preview, m.cwd, TEST_TIMEOUT_MS);
          d.store.append(sid, {
            kind: "check",
            payload: {
              name: "preview",
              ok: r.code === 0 && !r.timedOut,
              output: tail(r.output),
            },
          });
        }
        try {
          const pub = await publishBranch({
            forge: ctx.forge,
            githubRepo: a.githubRepo,
            repoDir: a.repoDir,
            wt,
            mainBranch: a.mainBranch,
            title: a.title,
            body: prBody(ctx, sid, a),
            pr: a.pr,
          });
          if (pub) {
            if (pub.created)
              log(`已创建 PR #${pub.pr.number}（${pub.pr.url}）`);
            a.pr = pub.pr;
          }
        } catch (e) {
          // 推送或建 PR 失败：记录为检查失败，稍后重试；仍然回传提交，让人能看到现状
          // 第一行只有“Command failed: <命令>”，真正的原因（git/gh 的 stderr）在后面几行，一起记下
          const msg = (e as Error).message
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .slice(0, 6)
            .join(" ｜ ")
            .slice(0, 600);
          d.store.append(sid, {
            kind: "check",
            payload: {
              name: "publish",
              ok: false,
              output: `推送分支或创建 PR 失败：${msg}`,
            },
          });
          log(`推送或建 PR 失败（会话 ${sid}）：${msg}`);
          a.retryAt = Date.now() + 60_000;
          continue;
        }
        await forwardEvents(ctx, sid, a);
        if (a.lost) continue;
        if (a.technicalPlan)
          d.store.updateMeta(sid, {
            planResultPending: {
              round: a.round,
              head,
              pr: a.pr,
              markdown: `## 实际改动与验证\n${lastAgentReport(d, sid, 59000)}\n\n提交：${head}\nPR：${a.pr?.url ?? "尚未创建"}`,
            },
          });
        await reportImplementation(ctx, sid, a, head);
      }

      // 5. 收件箱：人的回复 → 会话；人的回答 → 等待中的权限或决定
      for (const [sid, a] of active) {
        if (a.lost) continue;
        const r = await gw.call<{
          ok: boolean;
          items: {
            id: number;
            kind: "message" | "decision" | "republish";
            body: string | null;
            requestId: string | null;
            optionId: string | null;
          }[];
        }>("GET", `/api/daemon/sessions/${sid}/inbox?after=${a.inboxCursor}`);
        for (const item of r.data.items ?? []) {
          if (item.kind === "republish") {
            // 人点了“重新推送并创建 PR”：清掉回传记录与重试等待，下一轮立刻重新推送、建 PR
            a.reportedHead = null;
            a.retryAt = 0;
            log(`收到重新推送并创建 PR 的请求（会话 ${sid}）`);
          } else {
            if (a.technicalPlan && item.kind === "message") {
              const response = await planState(ctx, a);
              if (response && response.phase !== "implementing") {
                // 新一轮的原始需求仍保留在收件箱，分析轮次使用相同会话。
                const meta = d.store.getMeta(sid);
                if (
                  response.phase !== "analyzing" ||
                  !meta ||
                  !["idle", "needs_you"].includes(meta.state)
                )
                  continue;
                if (!d.isLive(sid)) await d.resume(sid);
                d.store.updateMeta(sid, {
                  planRound: a.round,
                  analysisOnly: true,
                });
                d.reply(sid, `${item.body ?? ""}${TECHNICAL_PLAN_INSTRUCTION}`);
              } else
                await deliver(
                  d,
                  sid,
                  item as Parameters<typeof deliver>[2],
                  log,
                );
            } else
              await deliver(d, sid, item as Parameters<typeof deliver>[2], log);
          }
          await gw.call("POST", `/api/daemon/inbox/${item.id}/ack`);
          a.inboxCursor = item.id;
        }
      }

      // 5b. 卡住检测：运行中长时间没有输出，升级为"需要你"（不静默等待）
      for (const sid of active.keys()) {
        if (d.escalateIfStalled(sid, STALL_MS))
          log(`会话 ${sid} 长时间没有输出，已请求人工决定`);
      }

      // 6. 清理已结束的会话（事件已全部回传后）
      for (const [sid, a] of active) {
        const m = d.store.getMeta(sid);
        if (
          !a.lost &&
          m &&
          ["cancelled", "failed"].includes(m.state) &&
          a.forwarded >= d.store.lastSeq(sid)
        )
          active.delete(sid);
      }
    } catch (e) {
      log(`循环异常（将重试）：${(e as Error).message}`);
    }
    // 按忙闲调整轮询频率：避免空转消耗数据库与 Worker 请求配额
    const states = [...active.keys()].map(
      (sid) => d.store.getMeta(sid)?.state ?? "running",
    );
    await sleep(
      opts.tickMs ?? nextTickMs(states, publishing.size > 0),
      opts.signal,
    );
  }
  await d.close();
}

function tail(s: string, n = 400): string {
  return s.trim().slice(-n);
}

/** 读取工作树里的 AGENTS.md（当前版本） */
function projectCommands(worktreePath: string): ProjectCommands {
  const p = join(worktreePath, "AGENTS.md");
  return existsSync(p) ? parseProjectCommands(readFileSync(p, "utf8")) : {};
}

function gitOut(cwd: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function currentHead(path: string): string | null {
  try {
    return execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: path,
      encoding: "utf8",
    }).trim();
  } catch {
    return null;
  }
}

/** 任务被驳回或取消：停止会话，关闭 PR，清理 worktree 与分支，释放租约，不再管理这个会话 */
async function retireTask(
  ctx: Ctx,
  sid: string,
  a: ActiveSession,
  stage: string,
): Promise<void> {
  const meta = ctx.d.store.getMeta(sid);
  a.lost = true; // 停止回传与续租
  await ctx.d.cancel(sid, { local: true }).catch(() => undefined);
  if (meta) {
    const wt: Worktree = {
      path: meta.cwd,
      branch: meta.branch,
      base: meta.base,
    };
    await retireBranch({
      forge: ctx.forge,
      githubRepo: a.githubRepo,
      repoDir: a.repoDir,
      wt,
      pr: a.pr,
      comment:
        stage === "rejected"
          ? "该任务已在 Loop 中被驳回，关闭此 PR。"
          : "该任务已在 Loop 中取消，关闭此 PR。",
    });
  }
  await ctx.gw
    .call("POST", `/api/daemon/leases/${a.leaseId}/release`, {
      daemonId: ctx.daemonId,
    })
    .catch(() => undefined);
  ctx.active.delete(sid);
  ctx.log(
    `任务 ${a.taskId} 已${stage === "rejected" ? "驳回" : "取消"}：已关闭 PR、清理工作树并释放租约`,
  );
}

/** 把会话里新增的事件送给网关（幂等：网关按 seq 去重） */
async function forwardEvents(
  ctx: Ctx,
  sid: string,
  a: ActiveSession,
): Promise<void> {
  if (a.lost) return;
  const pending = ctx.d.store.read(sid, a.forwarded);
  for (let i = 0; i < pending.length; i += 100) {
    const batch = pending.slice(i, i + 100);
    const r = await ctx.gw.call<{ ok: boolean; error?: string }>(
      "POST",
      `/api/daemon/sessions/${sid}/events`,
      {
        daemonId: ctx.daemonId,
        leaseId: a.leaseId,
        events: batch.map((e) => ({
          seq: e.seq,
          kind: e.kind,
          payload: e.payload,
          at: e.at,
        })),
      },
    );
    if (r.status === 409) {
      markLost(ctx.d, sid, a, ctx.log);
      return;
    }
    if (r.status !== 200) {
      ctx.log(`回传失败（${r.status}）：${r.data.error ?? ""}，稍后重试`);
      return;
    }
    a.forwarded = batch[batch.length - 1].seq;
  }
}

async function reportImplementation(
  ctx: Ctx,
  sid: string,
  a: ActiveSession,
  head: string,
): Promise<void> {
  const meta = ctx.d.store.getMeta(sid)!;
  if (a.technicalPlan) {
    const pending = meta.planResultPending;
    if (!pending || pending.round !== a.round || pending.head !== head)
      throw new Error("缺少待保存的实际改动记录");
    if (!a.pr && pending.pr) a.pr = pending.pr;
    const saved = await ctx.gw.call<{ error?: string }>(
      "POST",
      `/api/daemon/tasks/${a.taskId}/technical-plan`,
      {
        daemonId: ctx.daemonId,
        leaseId: a.leaseId,
        round: a.round,
        kind: "result",
        markdown: pending.markdown,
      },
    );
    if (saved.status !== 200) {
      if (saved.status === 409) markLost(ctx.d, sid, a, ctx.log);
      else {
        a.retryAt = Date.now() + 20000;
        ctx.log(`实际改动记录保存失败（${saved.status}），保留记录并稍后重试`);
      }
      return;
    }
  }
  const rep = await ctx.gw.call("POST", `/api/daemon/sessions/${sid}/head`, {
    daemonId: ctx.daemonId,
    leaseId: a.leaseId,
    head,
    branch: meta.branch,
    prNumber: a.pr?.number ?? null,
    prUrl: a.pr?.url ?? null,
  });
  if (rep.status === 200) {
    a.reportedHead = head;
    ctx.d.store.updateMeta(sid, {
      planResultPending: undefined,
      planResultHash: head,
    });
  } else if (rep.status === 409) markLost(ctx.d, sid, a, ctx.log);
}

async function planState(
  ctx: Ctx,
  a: ActiveSession,
): Promise<TechnicalPlanState | null> {
  const r = await ctx.gw.call<{ ok: boolean; plan: TechnicalPlanState | null }>(
    "GET",
    `/api/daemon/tasks/${a.taskId}/technical-plan?leaseId=${encodeURIComponent(a.leaseId)}&daemonId=${encodeURIComponent(ctx.daemonId)}`,
  );
  if (r.status !== 200) throw new Error(`读取技术方案失败（${r.status}）`);
  return r.data.plan;
}
/** true 表示仍处于方案流程，不能提交代码或创建 PR。 */
async function handleTechnicalPlan(
  ctx: Ctx,
  sid: string,
  a: ActiveSession,
): Promise<boolean> {
  const plan = await planState(ctx, a);
  if (!plan) throw new Error("任务缺少技术方案记录，已经暂停实现");
  const meta = ctx.d.store.getMeta(sid)!;
  if (plan.phase === "analyzing") {
    if (
      meta.planRound !== a.round ||
      meta.state !== "idle" ||
      meta.stopReason !== "end_turn"
    )
      return true;
    if (
      currentHead(meta.cwd) !== meta.base ||
      gitOut(meta.cwd, ["status", "--porcelain"]).trim()
    ) {
      await failLease(
        ctx,
        a.leaseId,
        "技术方案分析期间修改了文件或创建了提交，已经停止实现；请检查工作树后恢复任务",
      );
      return true;
    }
    try {
      const markdown = extractTechnicalPlan(lastAgentReport(ctx.d, sid, 65000));
      const result = await ctx.gw.call<{ error?: string }>(
        "POST",
        `/api/daemon/tasks/${a.taskId}/technical-plan`,
        {
          daemonId: ctx.daemonId,
          leaseId: a.leaseId,
          round: a.round,
          markdown,
          baselineHead: meta.base,
        },
      );
      if (result.status !== 200)
        throw new Error(
          result.data.error ?? `保存方案失败（${result.status}）`,
        );
    } catch (e) {
      ctx.log(`任务 ${a.taskId} 技术方案尚未保存：${(e as Error).message}`);
      a.retryAt = Date.now() + 20000;
    }
    return true;
  }
  if (plan.phase !== "implementing") return true;
  if (!plan.continuationId) throw new Error("方案缺少执行凭据，已经暂停实现");
  const continuation = meta.planContinuation;
  if (
    continuation?.id === plan.continuationId &&
    continuation.status === "completed"
  )
    return false;
  if (
    continuation?.id === plan.continuationId &&
    !continuation.recoveryRequired &&
    meta.state === "needs_you"
  )
    return true;
  if (!ctx.d.isLive(sid)) await ctx.d.resume(sid);
  const attempt =
    continuation?.id === plan.continuationId ? continuation.attempt + 1 : 1;
  ctx.d.store.updateMeta(sid, {
    analysisOnly: false,
    planContinuation: {
      id: plan.continuationId,
      attempt,
      status: "pending",
      eventSeq: ctx.d.store.lastSeq(sid),
      recoveryRequired: false,
    },
  });
  const recovery =
    attempt > 1
      ? "\n上一次执行被中断。请先检查当前工作树、提交和已完成操作，接着完成尚未完成的部分，避免重复执行外部操作。\n"
      : "";
  ctx.d.reply(sid, continuationPrompt(plan) + recovery);
  return true;
}

/** 工程师提示词模板 + 任务内容。需要方案审核的任务，第一轮只出方案，不改文件。 */
export function buildPrompt(
  title: string,
  body: string,
  planFirst = false,
  instructions?: string | null,
): string {
  const template = readFileSync(PROMPT_PATH, "utf8");
  const plan = planFirst
    ? "\n\n## 本轮要求：方案审核\n这个任务需要先经过人工审核方案。本轮请只阅读代码，输出实现方案：要改的文件、改动要点、验证方式、风险。**不要修改任何文件，不要提交**。写完方案即结束本轮；人批准后你会收到“方案已通过”的消息，再开始实现。"
    : "";
  const project = instructions?.trim()
    ? `\n\n## 项目说明（项目负责人维护，对这个项目的所有任务都适用）\n${instructions.trim().slice(0, 8000)}`
    : "";
  return `${template}${project}${plan}\n\n## 任务\n标题：${title}\n\n${body || "（没有补充说明）"}`;
}

/** 最近一轮智能体的回复（交付报告），用作 PR 正文 */
function lastAgentReport(d: LoopDaemon, sid: string, limit = 3000): string {
  const events = d.store.read(sid);
  let from = 0;
  events.forEach((e, i) => {
    if (e.kind === "message" && (e.payload as { role: string }).role === "user")
      from = i + 1;
  });
  return events
    .slice(from)
    .filter(
      (e) =>
        e.kind === "message" &&
        (e.payload as { role: string }).role === "agent",
    )
    .map((e) => (e.payload as { text: string }).text)
    .join("")
    .trim()
    .slice(0, limit);
}

function prBody(ctx: Ctx, sid: string, a: ActiveSession): string {
  const report = lastAgentReport(ctx.d, sid);
  return [
    a.body || "（没有补充说明）",
    "",
    "---",
    `由 Loop 创建 · 任务：${ctx.gateway}/tasks/${a.taskId}`,
    report ? `\n### 交付报告\n${report}` : "",
  ].join("\n");
}

async function failLease(
  ctx: Ctx,
  leaseId: string,
  reason: string,
): Promise<void> {
  await ctx.gw.call("POST", `/api/daemon/leases/${leaseId}/fail`, {
    daemonId: ctx.daemonId,
    reason,
  });
}

/** 任务启动失败的连续次数（进程内） */
const startFailures = new Map<string, number>();
const START_GAP_MS = 5000;
let lastStartAt = 0;

async function startOrReattach(ctx: Ctx, claim: Claim): Promise<void> {
  const { d, log, active } = ctx;
  const t = claim.task;
  if (!t.githubRepo) {
    log(`任务 ${t.id} 所在项目没有 GitHub 仓库，标记失败`);
    await failLease(
      ctx,
      claim.leaseId,
      "项目没有配置 GitHub 仓库（所有改动都要通过 PR 进入主分支）",
    );
    return;
  }
  // 任务已有会话，但本机没有它的记录（换了机器或本地数据丢失）：不能悄悄另起一个会话，否则会重复工作
  if (t.sessionId && !d.store.getMeta(t.sessionId)) {
    log(
      `任务 ${t.id} 的会话 ${t.sessionId} 在本机没有记录，标记失败，避免重复开始`,
    );
    await failLease(
      ctx,
      claim.leaseId,
      "本机没有该任务会话的记录，需要人工处理",
    );
    return;
  }
  const base = {
    githubRepo: t.githubRepo,
    mainBranch: t.mainRef,
    title: t.title,
    body: t.body,
    pr: t.prNumber && t.prUrl ? { number: t.prNumber, url: t.prUrl } : null,
    retryAt: 0,
    technicalPlan: !!t.technicalPlan?.required,
    round: t.round ?? 1,
  };
  // 本进程已经在管理这个会话（每轮领取都会把自己持有的任务再返回一次）：只更新租约，不重置回传进度
  const known = t.sessionId ? active.get(t.sessionId) : undefined;
  if (known && !known.lost) {
    known.leaseId = claim.leaseId;
    return;
  }
  if (known) active.delete(t.sessionId!); // 租约丢过又被重新派到本机：按重新接管处理，不新开会话
  // 本机已有这个任务的会话，一律接管它，绝不新开会话（否则同一任务会被做两遍）
  if (t.sessionId && d.store.getMeta(t.sessionId)) {
    const sid = t.sessionId;
    const meta = d.store.getMeta(sid)!;
    // 工作树被清理过（取消/驳回后人又恢复了任务）：先从分支或 PR 记录重建，再恢复会话
    try {
      const r = await restoreWorktree({
        repo: meta.repo,
        wt: { path: meta.cwd, branch: meta.branch, base: meta.base },
        prNumber: () => lastPrNumber(t.githubRepo!, meta.branch, meta.repo),
      });
      if (r === "restored")
        log(`已重建任务 ${t.id} 的工作树（${meta.branch}）`);
      if (r === "missing") {
        log(`任务 ${t.id} 的工作树已被清理，且找不到分支或 PR 记录，无法恢复`);
        await failLease(
          ctx,
          claim.leaseId,
          "工作树已被清理，也找不到分支或 PR 记录，无法恢复；请用“重新开始”",
        );
        return;
      }
    } catch (e) {
      log(
        `重建工作树失败（任务 ${t.id}）：${(e as Error).message.split("\n")[0]}`,
      );
    }
    // 发布后继续迭代（第 N+1 轮）：上一轮的 PR 已合并。工作树对齐到最新的主分支，作为这一轮的新基线，
    // 并且不再转发旧会话里过期的事件（否则“已取消”之类的旧状态会把任务打回去）
    let forwarded = -1;
    let title = base.title;
    const round = t.round ?? 1;
    if (round > (meta.round ?? 1)) {
      try {
        await ctx.forge.fetch(meta.repo);
        const head = await startNewRound(meta.cwd, t.mainRef);
        d.store.updateMeta(sid, { base: head, round });
        meta.base = head;
        forwarded = d.store.read(sid).reduce((m, e) => Math.max(m, e.seq), -1);
        log(
          `任务 ${t.id} 进入第 ${round} 轮：工作树已对齐 origin/${t.mainRef}（${head.slice(0, 8)}）`,
        );
      } catch (e) {
        log(
          `任务 ${t.id} 第 ${round} 轮准备失败：${(e as Error).message.split("\n")[0]}`,
        );
        await failLease(
          ctx,
          claim.leaseId,
          `准备第 ${round} 轮失败：${(e as Error).message.split("\n")[0]}`,
        );
        return;
      }
    }
    if (round > 1) title = `${base.title}（第 ${round} 轮）`;
    if (!d.isLive(sid))
      await d
        .resume(sid)
        .catch((e) => log(`恢复会话 ${sid} 失败：${(e as Error).message}`));
    active.set(sid, {
      leaseId: claim.leaseId,
      taskId: t.id,
      forwarded,
      inboxCursor: 0,
      lost: false,
      reportedHead: null,
      repoDir: meta.repo,
      ...base,
      title,
    });
    log(`重新接管任务 ${t.id} 的会话 ${sid}`);
    return;
  }
  let sid: string;
  let repoDir: string;
  try {
    // 确保本机有一份检出（已有路径或在数据目录克隆）并拉取最新；worktree 永远从 origin/<主分支> 建出
    // 多个任务同时启动智能体时错峰（grok 并发冷启动偶发 Internal error）
    const wait = lastStartAt + START_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastStartAt = Date.now();
    repoDir = await ctx.forge.ensureCheckout({
      githubRepo: t.githubRepo,
      localPath: t.repoPath,
      dataDir: ctx.dataDir,
    });
    sid = await d.start({
      taskId: t.id,
      analysisOnly: !!t.technicalPlan?.required,
      branchName: branchBase(t.id, t.title),
      repo: repoDir,
      agent: t.agent,
      prompt:
        buildPrompt(
          t.title,
          t.body,
          !!t.attributes?.planReview && !t.technicalPlan?.required,
          t.instructions,
        ) + (t.technicalPlan?.required ? TECHNICAL_PLAN_INSTRUCTION : ""),
      model: t.model,
      effort: t.effort,
      mainRef: `origin/${t.mainRef}`,
    });
  } catch (e) {
    // 领取后启动失败：必须回报网关释放租约并标记失败，否则会在租约过期后反复重派（死循环）
    const reason = (e as Error).message.split("\n")[0];
    // 网络等瞬时问题：不立刻判失败。放弃这次领取，租约过期后网关会重新派发；连续 3 次才失败
    const n = (startFailures.get(t.id) ?? 0) + 1;
    startFailures.set(t.id, n);
    if (n < 3) {
      log(`任务 ${t.id} 启动失败（第 ${n} 次，稍后重试）：${reason}`);
      return;
    }
    startFailures.delete(t.id);
    log(`任务 ${t.id} 启动连续失败 ${n} 次：${reason}`);
    await failLease(ctx, claim.leaseId, `连续 ${n} 次启动失败：${reason}`);
    return;
  }
  if (t.technicalPlan?.required)
    d.store.updateMeta(sid, { planRound: t.round ?? 1 });
  active.set(sid, {
    leaseId: claim.leaseId,
    taskId: t.id,
    forwarded: -1,
    inboxCursor: 0,
    lost: false,
    reportedHead: null,
    repoDir,
    ...base,
  });
  log(`领取任务 ${t.id}，开始会话 ${sid}（智能体 ${t.agent}）`);
}

/** 发布：同步主分支 → 只合并批准的提交（合并 PR）→ 在主检出目录切到主分支拉最新，开智能体自己发布 → 等人确认结果 */
function startPublish(ctx: Ctx, claim: Claim): void {
  const t = claim.task;
  // 同一任务已经在发布：网关会把仍持有的租约再次返回，这里不重复执行
  if (isPublishing(ctx.publishing, t.id)) return;
  const lease: PublishLease = {
    leaseId: claim.leaseId,
    taskId: t.id,
    done: false,
  };
  ctx.publishing.set(claim.leaseId, lease);
  ctx.log(
    `开始发布任务 ${t.id}（批准的提交 ${t.approvedSha?.slice(0, 8) ?? "无"}）`,
  );
  void runPublish(ctx, claim).then((outcome) => {
    lease.done = true;
    ctx.publishing.delete(claim.leaseId);
    // 已发布或失败：这个任务的工作会话完成使命，停止回传与收件箱轮询。
    // 需要重新审核：工作会话仍在，要继续报告提交（否则重新批准时网关拿不到新提交）。
    if (outcome !== "review_needed")
      for (const [sid, a] of ctx.active)
        if (a.taskId === t.id) ctx.active.delete(sid);
  });
}

function isPublishing(
  publishing: Map<string, PublishLease>,
  taskId: string,
): boolean {
  for (const p of publishing.values())
    if (p.taskId === taskId && !p.done) return true;
  return false;
}

async function complete(
  ctx: Ctx,
  leaseId: string,
  outcome: "published" | "agent_done" | "failed" | "review_needed",
  output: string,
): Promise<void> {
  const r = await ctx.gw.call(
    "POST",
    `/api/daemon/leases/${leaseId}/complete`,
    { daemonId: ctx.daemonId, outcome, output },
  );
  ctx.log(
    `发布结果回传（${outcome}）：${r.status === 200 ? "已记录" : `失败 ${r.status}`}`,
  );
}

async function runPublish(
  ctx: Ctx,
  claim: Claim,
): Promise<"published" | "agent_done" | "failed" | "review_needed"> {
  const { d } = ctx;
  const t = claim.task;
  const fail = async (msg: string) => {
    await complete(ctx, claim.leaseId, "failed", msg);
    return "failed" as const;
  };
  const approved = t.approvedSha;
  if (!approved) return fail("没有批准的提交");
  if (!t.githubRepo || !t.prNumber) return fail("任务没有 PR，无法合并");
  const meta = t.sessionId ? d.store.getMeta(t.sessionId) : null;
  if (!meta) return fail("本机没有该任务的工作树记录，无法发布");
  const wt: Worktree = { path: meta.cwd, branch: meta.branch, base: meta.base };
  const repoDir = meta.repo;

  // 1. 同步主分支并合并 PR：提交变了就回到待审核；只合并批准的那个提交
  let merged;
  try {
    merged = await syncAndMerge({
      forge: ctx.forge,
      githubRepo: t.githubRepo,
      repoDir,
      wt,
      mainBranch: t.mainRef,
      prNumber: t.prNumber,
      approvedSha: approved,
    });
  } catch (e) {
    return fail(`合并流程出错：${(e as Error).message.split("\n")[0]}`);
  }
  if (merged.outcome === "review_needed") {
    await complete(ctx, claim.leaseId, "review_needed", merged.detail);
    return "review_needed";
  }
  if (merged.outcome === "failed") return fail(merged.detail);

  // 2. 工作树同步到合并后的主分支，对原来的会话发“开始发布”，同一个智能体按 AGENTS.md 自己发布；成败交给人确认
  const sid = t.sessionId!;
  let result: "published" | "agent_done" | "failed";
  let output: string;
  try {
    await syncToMergedMain(wt, t.mainRef, merged.mergeSha);
    const r = await runPublishInSession(
      d,
      sid,
      publishPrompt(merged.mergeSha, t.mainRef),
      PUBLISH_TIMEOUT_MS,
    );
    if (r.state === "idle") {
      // 智能体明确说成功/失败就直接定；没有按约定给出结论才交给人确认
      const v = parseVerdict(r.reply);
      result =
        v.verdict === "success"
          ? "published"
          : v.verdict === "failure"
            ? "failed"
            : "agent_done";
      output = v.summary || "（智能体没有给出说明）";
      if (v.verdict === "failure") output = `发布失败：${output}`;
    } else {
      result = "failed";
      output = `PR 已合并（${merged.mergeSha.slice(0, 8)}），但发布会话停在“${r.state}”：${tail(r.reply)}`;
    }
  } catch (e) {
    result = "failed";
    output = `PR 已合并（${merged.mergeSha.slice(0, 8)}），但发布没有完成：${(e as Error).message.split("\n")[0]}`;
  }
  // 发布会话的最后几条事件要先回传，再收尾（工作树保留，供人查看和确认）
  const act = ctx.active.get(sid);
  if (act && !act.lost)
    await forwardEvents(ctx, sid, act).catch(() => undefined);
  await d.cancel(sid, { local: true }).catch(() => undefined);
  // 代码已经进了主分支：远端分支可以删（本地工作树保留，供人查看）
  await ctx.forge
    .deleteRemoteBranch({ repoDir, branch: wt.branch })
    .catch(() => undefined);
  await complete(ctx, claim.leaseId, result, output);
  return result;
}

async function deliver(
  d: LoopDaemon,
  sid: string,
  item: {
    kind: "message" | "decision";
    body: string | null;
    requestId: string | null;
    optionId: string | null;
  },
  log: (m: string) => void,
): Promise<void> {
  try {
    if (item.kind === "decision") {
      if (item.requestId) d.answer(sid, item.requestId, item.optionId!);
      else await d.resolveNeedsYou(sid, item.optionId!);
      return;
    }
    if (!d.isLive(sid)) await d.resume(sid);
    d.reply(sid, item.body ?? "");
  } catch (e) {
    log(`投递回复失败（会话 ${sid}）：${(e as Error).message}`);
  }
}

function markLost(
  d: LoopDaemon,
  sid: string,
  a: ActiveSession,
  log: (m: string) => void,
): void {
  a.lost = true;
  log(`任务 ${a.taskId} 的租约已被网关收回，停止写入会话 ${sid}`);
  void d.cancel(sid, { local: true });
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((r) => {
    const t = setTimeout(r, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(t);
      r();
    });
  });
}

/** 机器 ID：LOOPD_MACHINE_ID，其次 LOOPD_DAEMON_ID（旧名），默认取主机名并规整为小写字母数字与连字符 */
export function defaultDaemonId(): string {
  return machineIdFrom(
    process.env.LOOPD_MACHINE_ID ?? process.env.LOOPD_DAEMON_ID ?? hostname(),
  );
}

export function machineIdFrom(raw: string): string {
  const id = raw
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 64);
  return id || "machine";
}
