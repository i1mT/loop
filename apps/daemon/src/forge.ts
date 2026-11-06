// Forge：代码托管平台的操作抽象。守护进程通过它完成：确保检出、拉取、推送、建 PR、合并 PR。
// GitHub 实现用 git 与 gh；GitLab（含自建实例）用 git 与 REST API（GITLAB_TOKEN）；
// 测试用本地裸仓库加内存 PR 的假实现（src/testing/fake-forge.ts）。
import { execFile } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface PrRef {
  number: number;
  url: string;
}

export interface PrInfo {
  state: "OPEN" | "MERGED" | "CLOSED";
  /** 合并后主分支上的提交（仅已合并时有值） */
  mergeSha: string | null;
}

export interface Forge {
  /** 确保本机有一份检出并返回其路径。有 localPath 则用它（校验 origin），否则在数据目录克隆。 */
  ensureCheckout(opts: { githubRepo: string; localPath?: string | null; dataDir: string }): Promise<string>;
  fetch(repoDir: string): Promise<void>;
  push(wtPath: string, branch: string, opts: { force: boolean }): Promise<void>;
  /** 查找分支上已有的开放 PR（避免重复创建） */
  findPr(opts: { githubRepo: string; head: string; cwd: string }): Promise<PrRef | null>;
  createPr(opts: { githubRepo: string; base: string; head: string; title: string; body: string; cwd: string }): Promise<PrRef>;
  /** 合并 PR，且只合并 matchHead 这个提交（审核过的那个）。 */
  mergePr(opts: { githubRepo: string; number: number; matchHead: string; cwd: string }): Promise<{ ok: boolean; output: string }>;
  prInfo(opts: { githubRepo: string; number: number; cwd: string }): Promise<PrInfo>;
  /** 关闭 PR（驳回或取消任务时）。已合并或已关闭则什么都不做。 */
  closePr(opts: { githubRepo: string; number: number; comment: string; cwd: string }): Promise<void>;
  /** 删除远端分支（失败不抛出） */
  deleteRemoteBranch(opts: { repoDir: string; branch: string }): Promise<void>;
  /** 分支上最近的 PR/MR 编号（任何状态）；没有返回 null。取消后分支被删，要靠它从记录里找回提交。 */
  lastPrNumber(opts: { githubRepo: string; branch: string; cwd: string }): Promise<number | null>;
}

/** 远端地址解析结果：host 用于判断代码托管平台，path 是 owner/name 或 GitLab 的多级 group 路径。 */
export interface RemoteRepo {
  host: string;
  path: string;
  protocol: "http" | "https";
}

/** 解析 git 远端地址：支持 git@host:path、ssh://、http(s)://；本地路径返回 null。 */
export function parseRemoteUrl(url: string): RemoteRepo | null {
  const raw = url.trim();
  if (!raw) return null;
  let rest = raw;
  let protocol: "http" | "https" = "https";
  const scheme = /^(https?):\/\//.exec(raw);
  if (scheme) {
    protocol = scheme[1] as "http" | "https";
    rest = raw.slice(scheme[0].length).replace(/^[^@/]+@/, "");
  } else if (raw.startsWith("ssh://")) {
    rest = raw.slice("ssh://".length).replace(/^[^@/]+@/, "");
  } else {
    // scp 形式：git@host:group/repo.git（本地路径没有冒号，会被下面的判断排除）
    const m = /^(?:[^@/]+@)?([^/:]+):(.+)$/.exec(raw);
    if (!m) return null;
    rest = `${m[1]}/${m[2]}`;
  }
  const slash = rest.indexOf("/");
  if (slash <= 0) return null;
  const host = rest.slice(0, slash).replace(/:\d+$/, "");
  const path = rest
    .slice(slash + 1)
    .replace(/\.git$/, "")
    .replace(/\/+$/, "");
  if (!host || !path) return null;
  return { host, path, protocol };
}

/** 分支上最近的 PR 编号（任何状态，含已关闭）；没有返回 null。取消后分支被删，要靠它从 PR 记录里找回提交。 */
export async function lastPrNumber(githubRepo: string, branch: string, cwd: string): Promise<number | null> {
  const out = await sh("gh", ["pr", "list", "--repo", githubRepo, "--head", branch, "--state", "all", "--json", "number", "--limit", "1"], cwd);
  const n = (JSON.parse(out) as { number: number }[])[0]?.number;
  return n ?? null;
}

export function repoDirName(githubRepo: string): string {
  return githubRepo.replace("/", "__");
}

export function validGithubRepo(s: unknown): s is string {
  return typeof s === "string" && /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(s);
}

async function sh(cmd: string, args: string[], cwd?: string): Promise<string> {
  const { stdout } = await run(cmd, args, { cwd, maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 });
  return stdout.toString();
}

export class GitHubForge implements Forge {
  async ensureCheckout(opts: { githubRepo: string; localPath?: string | null; dataDir: string }): Promise<string> {
    if (!validGithubRepo(opts.githubRepo)) throw new Error(`GitHub 仓库格式应为 owner/name：${opts.githubRepo}`);
    let dir: string;
    if (opts.localPath) {
      dir = opts.localPath;
      if (!existsSync(dir)) throw new Error(`绑定的本机路径不存在：${dir}`);
      const origin = (await sh("git", ["remote", "get-url", "origin"], dir).catch(() => "")).trim();
      if (!origin.toLowerCase().includes(opts.githubRepo.toLowerCase())) {
        throw new Error(`该路径的 origin（${origin || "无"}）不是 ${opts.githubRepo}`);
      }
    } else {
      mkdirSync(join(opts.dataDir, "repos"), { recursive: true });
      dir = join(opts.dataDir, "repos", repoDirName(opts.githubRepo));
      if (!existsSync(dir)) await sh("gh", ["repo", "clone", opts.githubRepo, dir]);
    }
    await this.fetch(dir);
    return dir;
  }

  async fetch(repoDir: string): Promise<void> {
    await sh("git", ["fetch", "origin", "--prune"], repoDir);
  }

  async push(wtPath: string, branch: string, opts: { force: boolean }): Promise<void> {
    const args = ["push", "-u", "origin", branch];
    if (opts.force) args.splice(1, 0, "--force-with-lease");
    await sh("git", args, wtPath);
  }

  async findPr(opts: { githubRepo: string; head: string; cwd: string }): Promise<PrRef | null> {
    const out = await sh("gh", ["pr", "list", "--repo", opts.githubRepo, "--head", opts.head, "--state", "open", "--json", "number,url"], opts.cwd);
    const list = JSON.parse(out || "[]") as { number: number; url: string }[];
    return list[0] ?? null;
  }

  async createPr(opts: { githubRepo: string; base: string; head: string; title: string; body: string; cwd: string }): Promise<PrRef> {
    const out = await sh("gh", ["pr", "create", "--repo", opts.githubRepo, "--base", opts.base, "--head", opts.head, "--title", opts.title, "--body", opts.body], opts.cwd);
    const url = out.trim().split("\n").pop()!.trim();
    const m = url.match(/\/pull\/(\d+)/);
    if (!m) throw new Error(`无法从 gh 的输出解析 PR：${out.slice(0, 200)}`);
    return { number: Number(m[1]), url };
  }

  async mergePr(opts: { githubRepo: string; number: number; matchHead: string; cwd: string }): Promise<{ ok: boolean; output: string }> {
    try {
      // 不用 --delete-branch：它会尝试删除本地分支，而分支正被 worktree 使用；清理由调用方负责
      const out = await sh("gh", ["pr", "merge", String(opts.number), "--repo", opts.githubRepo, "--squash", "--match-head-commit", opts.matchHead], opts.cwd);
      return { ok: true, output: out.trim() };
    } catch (e) {
      const err = e as { stderr?: string; message: string };
      return { ok: false, output: (err.stderr || err.message).trim().slice(0, 600) };
    }
  }

  async prInfo(opts: { githubRepo: string; number: number; cwd: string }): Promise<PrInfo> {
    const out = await sh("gh", ["pr", "view", String(opts.number), "--repo", opts.githubRepo, "--json", "state,mergeCommit"], opts.cwd);
    const j = JSON.parse(out) as { state: PrInfo["state"]; mergeCommit?: { oid: string } | null };
    return { state: j.state, mergeSha: j.mergeCommit?.oid ?? null };
  }

  async closePr(opts: { githubRepo: string; number: number; comment: string; cwd: string }): Promise<void> {
    const info = await this.prInfo(opts);
    if (info.state !== "OPEN") return;
    await sh("gh", ["pr", "close", String(opts.number), "-R", opts.githubRepo, "--comment", opts.comment], opts.cwd);
  }

  async deleteRemoteBranch(opts: { repoDir: string; branch: string }): Promise<void> {
    await sh("git", ["push", "origin", "--delete", opts.branch], opts.repoDir).catch(() => undefined);
  }

  async lastPrNumber(opts: { githubRepo: string; branch: string; cwd: string }): Promise<number | null> {
    return lastPrNumber(opts.githubRepo, opts.branch, opts.cwd);
  }
}

interface GitLabMr {
  iid: number;
  web_url: string;
  state: "opened" | "merged" | "closed" | "locked";
  sha: string;
  merge_commit_sha: string | null;
}

/** 自建 GitLab：git 操作用 SSH/HTTP 凭据，PR（MR）走 REST API（需要 api scope 的 GITLAB_TOKEN）。 */
export class GitLabForge implements Forge {
  private readonly base: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: {
    host: string;
    protocol?: "http" | "https";
    token?: string;
    fetchImpl?: typeof fetch;
  }) {
    this.token = opts.token ?? process.env.GITLAB_TOKEN ?? "";
    if (!this.token)
      throw new Error(
        `检测到 GitLab 仓库（${opts.host}），但守护进程没有配置 GITLAB_TOKEN（需要 api 权限的访问令牌）`,
      );
    this.base = `${opts.protocol ?? "https"}://${opts.host}/api/v4`;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async api<T>(
    method: string,
    route: string,
    body?: unknown,
  ): Promise<T> {
    const response = await this.fetchImpl(`${this.base}${route}`, {
      method,
      headers: {
        "PRIVATE-TOKEN": this.token,
        "content-type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    const text = await response.text();
    let payload: unknown = null;
    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }
    if (!response.ok) {
      const detail =
        (payload as { message?: unknown; error?: string } | null)?.message ??
        (payload as { error?: string } | null)?.error ??
        text;
      throw new Error(
        `GitLab 操作失败（HTTP ${response.status}）：${String(detail).slice(0, 300)}`,
      );
    }
    return payload as T;
  }

  private project(repo: string): string {
    return `/projects/${encodeURIComponent(repo)}`;
  }

  private async mr(repo: string, number: number): Promise<GitLabMr> {
    return this.api<GitLabMr>(
      "GET",
      `${this.project(repo)}/merge_requests/${number}`,
    );
  }

  async ensureCheckout(opts: {
    githubRepo: string;
    localPath?: string | null;
    dataDir: string;
  }): Promise<string> {
    // 自建 GitLab 的克隆凭证由用户自己配好；这里只认本机已有检出，避免把令牌写进命令或仓库。
    if (!opts.localPath)
      throw new Error(
        `GitLab 项目需要先在本机 clone（${opts.githubRepo}），并在项目设置里填写本机路径`,
      );
    if (!existsSync(opts.localPath))
      throw new Error(`绑定的本机路径不存在：${opts.localPath}`);
    const origin = (
      await sh("git", ["remote", "get-url", "origin"], opts.localPath).catch(
        () => "",
      )
    ).trim();
    const remote = parseRemoteUrl(origin);
    if (!remote || remote.path.toLowerCase() !== opts.githubRepo.toLowerCase())
      throw new Error(
        `该路径的 origin（${origin || "无"}）不是 ${opts.githubRepo}`,
      );
    await this.fetch(opts.localPath);
    return opts.localPath;
  }

  async fetch(repoDir: string): Promise<void> {
    await sh("git", ["fetch", "origin", "--prune"], repoDir);
  }

  async push(
    wtPath: string,
    branch: string,
    opts: { force: boolean },
  ): Promise<void> {
    const args = ["push", "-u", "origin", branch];
    if (opts.force) args.splice(1, 0, "--force-with-lease");
    await sh("git", args, wtPath);
  }

  async findPr(opts: {
    githubRepo: string;
    head: string;
    cwd: string;
  }): Promise<PrRef | null> {
    const list = await this.api<GitLabMr[]>(
      "GET",
      `${this.project(opts.githubRepo)}/merge_requests?state=opened&source_branch=${encodeURIComponent(opts.head)}`,
    );
    const first = list[0];
    return first ? { number: first.iid, url: first.web_url } : null;
  }

  async createPr(opts: {
    githubRepo: string;
    base: string;
    head: string;
    title: string;
    body: string;
    cwd: string;
  }): Promise<PrRef> {
    const mr = await this.api<GitLabMr>(
      "POST",
      `${this.project(opts.githubRepo)}/merge_requests`,
      {
        source_branch: opts.head,
        target_branch: opts.base,
        title: opts.title,
        description: opts.body,
        remove_source_branch: false,
      },
    );
    return { number: mr.iid, url: mr.web_url };
  }

  async mergePr(opts: {
    githubRepo: string;
    number: number;
    matchHead: string;
    cwd: string;
  }): Promise<{ ok: boolean; output: string }> {
    try {
      const mr = await this.mr(opts.githubRepo, opts.number);
      if (mr.state !== "opened")
        return { ok: false, output: `MR !${opts.number} 状态是 ${mr.state}` };
      // sha 参数让 GitLab 拒绝合并已经变化的提交（对应 gh 的 --match-head-commit）
      if (mr.sha !== opts.matchHead)
        return {
          ok: false,
          output: `MR !${opts.number} 的提交已变（${mr.sha.slice(0, 8)} ≠ ${opts.matchHead.slice(0, 8)}），需要重新审核`,
        };
      await this.api(
        "PUT",
        `${this.project(opts.githubRepo)}/merge_requests/${opts.number}/merge`,
        {
          sha: opts.matchHead,
          should_remove_source_branch: false,
        },
      );
      return { ok: true, output: "merged" };
    } catch (e) {
      return { ok: false, output: (e as Error).message.slice(0, 600) };
    }
  }

  async prInfo(opts: {
    githubRepo: string;
    number: number;
    cwd: string;
  }): Promise<PrInfo> {
    const mr = await this.mr(opts.githubRepo, opts.number);
    const state: PrInfo["state"] =
      mr.state === "opened"
        ? "OPEN"
        : mr.state === "merged"
          ? "MERGED"
          : "CLOSED";
    return { state, mergeSha: mr.merge_commit_sha ?? null };
  }

  async closePr(opts: {
    githubRepo: string;
    number: number;
    comment: string;
    cwd: string;
  }): Promise<void> {
    const mr = await this.mr(opts.githubRepo, opts.number);
    if (mr.state !== "opened") return;
    await this.api(
      "PUT",
      `${this.project(opts.githubRepo)}/merge_requests/${opts.number}`,
      { state_event: "close" },
    );
    await this.api(
      "POST",
      `${this.project(opts.githubRepo)}/merge_requests/${opts.number}/notes`,
      { body: opts.comment },
    ).catch(() => undefined);
  }

  async deleteRemoteBranch(opts: {
    repoDir: string;
    branch: string;
  }): Promise<void> {
    await sh("git", ["push", "origin", "--delete", opts.branch], opts.repoDir).catch(
      () => undefined,
    );
  }

  async lastPrNumber(opts: {
    githubRepo: string;
    branch: string;
    cwd: string;
  }): Promise<number | null> {
    const list = await this.api<GitLabMr[]>(
      "GET",
      `${this.project(opts.githubRepo)}/merge_requests?state=all&source_branch=${encodeURIComponent(opts.branch)}&order_by=created_at&sort=desc&per_page=1`,
    );
    return list[0]?.iid ?? null;
  }
}
