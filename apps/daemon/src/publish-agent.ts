// 发布：PR 合并后，把任务的工作树同步到合并后的主分支，再对原来的会话发一条“开始发布”的消息，
// 由同一个智能体（它已经了解这次改动）按项目 AGENTS.md 自己发布。成败不由程序判断，交给人确认。
import type { LoopDaemon } from "./daemon.ts";
import { git, type Worktree } from "./worktree.ts";

/** 工作树切到合并后的主分支：任务分支已经合并，直接对齐到 origin/<主分支>（需要先 fetch）。 */
export async function syncToMergedMain(wt: Worktree, mainBranch: string, mergeSha: string): Promise<void> {
  await git(wt.path, "reset", "--hard", `origin/${mainBranch}`);
  const ok = await git(wt.path, "merge-base", "--is-ancestor", mergeSha, "HEAD").then(() => true, () => false);
  if (!ok) throw new Error(`${mainBranch} 上没有合并提交 ${mergeSha.slice(0, 8)}，无法发布`);
}

export function publishPrompt(targetSha: string, mainBranch: string, mergedSha = targetSha): string {
  const target = targetSha.slice(0, 8);
  const merged = mergedSha.slice(0, 8);
  return [
    targetSha === mergedSha
      ? `PR 已合并到 ${mainBranch}（合并提交 ${merged}）。当前工作目录已经同步为最新的 ${mainBranch}，不再在任务分支上。`
      : `当前工作目录已经同步为最新的 ${mainBranch}（HEAD ${target}），其中包含本任务的合并提交 ${merged}。分支名可能仍是任务分支，以当前 HEAD 为准。`,
    `发布目标是当前 HEAD（${targetSha}）。部署确认号、版本号都使用这个完整提交，不要使用更早的合并提交。`,
    "现在请把它发布到生产环境：阅读项目 AGENTS.md（以及它引用的文档）里关于部署/发布的约定，按约定执行。不要改动代码、不要提交。",
    "发布过程中遇到可以自行解决的问题（例如测试失败、构建失败、数据库迁移冲突、配置位置、依赖或临时服务状态），请直接排查并修复，然后继续发布，不要因为一次失败就停下。只有涉及不可逆的数据删除/覆盖、可能造成重大线上影响，或确实缺少只有人才能提供的信息时，才停下来。",
    "如果必须停下，请在最后一行写「发布结果：失败（需要人工：具体需要什么）」，不要只写“失败了”就结束。",
    "注意：这是个独立的工作树，被 git 忽略的本地配置文件（如 .env）不在这里；部署需要的令牌和配置请按 AGENTS.md 写明的固定位置读取。",
    "如果 AGENTS.md 里找不到发布方式，不要猜，直接说明缺什么并结束。",
    "结束时先用几句话说明：做了什么、线上地址或版本、有没有失败的步骤；最后另起一行，只写下面两种之一（系统据此判定，不要改措辞）：",
    "发布结果：成功",
    "发布结果：失败（一句话原因）",
  ].join("\n");
}

export interface PublishRun {
  /** 智能体这一轮的完整回复 */
  reply: string;
  /** 这一轮结束时会话的状态：idle 表示正常结束 */
  state: string;
}

/** 会话没有停在空闲状态（常见于守护进程重启把会话标成 crashed/needs_you）：发布无法开始。 */
export class PublishUnavailableError extends Error {
  readonly state: string;
  constructor(state: string) {
    super(`会话当前状态是 ${state}，不能开始发布`);
    this.name = "PublishUnavailableError";
    this.state = state;
  }
}

/** 对已有会话发一条消息并等这一轮结束（会话没在运行就先恢复）。
 * resetWaiting 仅用于人明确重试一个已经合并的发布：重启或中断留下的 crashed/needs_you
 * 不应再拦住这次发布，但仍在运行的会话（可能有真实权限请求）不重置。
 */
export async function runPublishInSession(
  d: LoopDaemon,
  sid: string,
  prompt: string,
  timeoutMs: number,
  options: { resetWaiting?: boolean } = {},
): Promise<PublishRun> {
  const wasLive = d.isLive(sid);
  if (!wasLive) await d.resume(sid);
  let before = await d.waitFor(sid, ["idle", "needs_you", "failed", "cancelled", "crashed", "ended"], 30_000);
  if (
    options.resetWaiting &&
    !wasLive &&
    ["crashed", "needs_you"].includes(before.state)
  ) {
    d.resetForPublish(sid);
    before = await d.waitFor(sid, ["idle"], 10_000);
  }
  if (before.state !== "idle") throw new PublishUnavailableError(before.state);
  const mark = d.store.lastSeq(sid);
  d.reply(sid, prompt);
  const end = await d.waitFor(sid, ["idle", "needs_you", "failed", "cancelled", "crashed", "ended"], timeoutMs);
  const reply = d.store
    .read(sid, mark)
    .filter((e) => e.kind === "message" && (e.payload as { role?: string }).role === "agent")
    .map((e) => String((e.payload as { text?: string }).text ?? ""))
    .join("")
    .trim();
  return { reply, state: end.state };
}

export interface Verdict {
  /** success / failure：智能体明确给出的结论；unclear：没有按约定给出 */
  verdict: "success" | "failure" | "unclear";
  /** 去掉结论行后的总结 */
  summary: string;
}

/** 从回复里取最后一条“发布结果：成功/失败”。没有就是 unclear，交给人确认，不猜。 */
export function parseVerdict(reply: string): Verdict {
  const lines = reply.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = lines[i].trim().match(/^[*_`>\s]*发布结果\s*[:：]\s*(成功|失败)(.*)$/);
    if (!m) continue;
    const summary = lines.filter((_, j) => j !== i).join("\n").trim();
    return m[1] === "成功" ? { verdict: "success", summary } : { verdict: "failure", summary: `${summary}\n${m[2].replace(/^[（(:：\s]+|[）)\s]+$/g, "")}`.trim() };
  }
  return { verdict: "unclear", summary: reply.trim() };
}
