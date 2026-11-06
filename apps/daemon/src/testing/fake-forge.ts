// 假 Forge：本地裸仓库当 origin，内存里记 PR。git 操作都是真的，用来严格测试推送、PR、rebase、合并保护。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Forge, PrInfo, PrRef } from "../forge.ts";

interface FakePr {
  number: number;
  head: string;
  base: string;
  title: string;
  body: string;
  state: "OPEN" | "MERGED" | "CLOSED";
  mergeSha: string | null;
}

const g = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString();

export class FakeForge implements Forge {
  readonly origin: string;
  readonly prs: FakePr[] = [];
  mergeCalls = 0;

  /** 建一个带初始提交的裸仓库作为 origin */
  constructor(files: Record<string, string> = { "a.txt": "hello\n" }) {
    this.origin = mkdtempSync(join(tmpdir(), "fakeorigin-")) + "/repo.git";
    mkdirSync(this.origin, { recursive: true });
    g(this.origin, "init", "--bare", "-b", "main");
    const seed = mkdtempSync(join(tmpdir(), "fakeseed-"));
    g(seed, "init", "-b", "main");
    this.identity(seed);
    for (const [name, content] of Object.entries(files)) writeFileSync(join(seed, name), content);
    g(seed, "add", "-A");
    g(seed, "commit", "-m", "init");
    g(seed, "remote", "add", "origin", this.origin);
    g(seed, "push", "origin", "main");
  }

  private identity(dir: string): void {
    g(dir, "config", "user.email", "t@loop.local");
    g(dir, "config", "user.name", "fake");
  }

  /** 在 origin 的 main 上直接推一个提交（模拟别的任务已合并/有人直接改了主分支） */
  advanceMain(file: string, content: string, message = "main moves"): string {
    const tmp = mkdtempSync(join(tmpdir(), "fakeadv-"));
    g(tmp, "clone", this.origin, ".");
    this.identity(tmp);
    writeFileSync(join(tmp, file), content);
    g(tmp, "add", "-A");
    g(tmp, "commit", "-m", message);
    g(tmp, "push", "origin", "main");
    return g(tmp, "rev-parse", "HEAD").trim();
  }

  remoteHead(branch: string): string | null {
    try {
      return g(this.origin, "rev-parse", `refs/heads/${branch}`).trim();
    } catch {
      return null;
    }
  }

  async ensureCheckout(opts: { githubRepo: string; localPath?: string | null; dataDir: string }): Promise<string> {
    const dir = opts.localPath ?? join(opts.dataDir, "repos", opts.githubRepo.replace("/", "__"));
    if (!existsSync(dir)) {
      mkdirSync(join(dir, ".."), { recursive: true });
      g(tmpdir(), "clone", this.origin, dir);
      this.identity(dir);
    }
    await this.fetch(dir);
    return dir;
  }

  async fetch(repoDir: string): Promise<void> {
    g(repoDir, "fetch", "origin", "--prune");
  }

  async push(wtPath: string, branch: string, opts: { force: boolean }): Promise<void> {
    const args = ["push", "-u", "origin", branch];
    if (opts.force) args.splice(1, 0, "--force-with-lease");
    g(wtPath, ...args);
  }

  async findPr(opts: { head: string }): Promise<PrRef | null> {
    const pr = this.prs.find((p) => p.head === opts.head && p.state === "OPEN");
    return pr ? { number: pr.number, url: `https://fake/pull/${pr.number}` } : null;
  }

  async createPr(opts: { base: string; head: string; title: string; body: string }): Promise<PrRef> {
    const pr: FakePr = { number: this.prs.length + 1, head: opts.head, base: opts.base, title: opts.title, body: opts.body, state: "OPEN", mergeSha: null };
    this.prs.push(pr);
    return { number: pr.number, url: `https://fake/pull/${pr.number}` };
  }

  async mergePr(opts: { number: number; matchHead: string }): Promise<{ ok: boolean; output: string }> {
    this.mergeCalls++;
    const pr = this.prs.find((p) => p.number === opts.number)!;
    if (pr.state !== "OPEN") return { ok: false, output: `PR 不是开放状态：${pr.state}` };
    const head = this.remoteHead(pr.head);
    if (head !== opts.matchHead) return { ok: false, output: `head 已变化（远端 ${head?.slice(0, 8)}，期望 ${opts.matchHead.slice(0, 8)}），拒绝合并` };
    const tmp = mkdtempSync(join(tmpdir(), "fakemerge-"));
    g(tmp, "clone", this.origin, ".");
    this.identity(tmp);
    g(tmp, "checkout", pr.base);
    try {
      g(tmp, "merge", "--squash", `origin/${pr.head}`);
    } catch (e) {
      return { ok: false, output: `合并冲突：${(e as Error).message.split("\n")[0]}` };
    }
    g(tmp, "commit", "-m", `${pr.title} (#${pr.number})`);
    g(tmp, "push", "origin", pr.base);
    pr.state = "MERGED";
    pr.mergeSha = g(tmp, "rev-parse", "HEAD").trim();
    return { ok: true, output: "merged" };
  }

  async closePr(opts: { number: number }): Promise<void> {
    const pr = this.prs.find((p) => p.number === opts.number)!;
    if (pr.state === "OPEN") pr.state = "CLOSED";
  }

  async prInfo(opts: { number: number }): Promise<PrInfo> {
    const pr = this.prs.find((p) => p.number === opts.number)!;
    return { state: pr.state, mergeSha: pr.mergeSha };
  }

  async lastPrNumber(opts: { branch: string }): Promise<number | null> {
    const list = this.prs.filter((p) => p.head === opts.branch);
    return list.length ? list[list.length - 1].number : null;
  }

  async deleteRemoteBranch(opts: { repoDir: string; branch: string }): Promise<void> {
    try {
      g(opts.repoDir, "push", "origin", "--delete", opts.branch);
    } catch {
      // 忽略
    }
  }
}
