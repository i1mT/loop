// PR 流程的严格测试：真实 git + 假 Forge（本地裸仓库当 origin）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FakeForge } from "./testing/fake-forge.ts";
import { git, tempDir } from "./testing/fixtures.ts";
import { branchBase, cleanupTask, commitLeftovers, publishBranch, retireBranch, syncAndMerge } from "./pr-flow.ts";
import { createWorktree, type Worktree } from "./worktree.ts";

const REPO = "o/r";

async function setup() {
  const forge = new FakeForge();
  const dataDir = tempDir("loopd-pr-");
  const repoDir = await forge.ensureCheckout({ githubRepo: REPO, dataDir });
  const wt = await createWorktree({ repo: repoDir, dataDir, taskId: "t1", mainRef: "origin/main", name: branchBase("11111111-2222", "Fix the title") });
  const ctx = (extra: object = {}) => ({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", title: "Fix the title", body: "说明", pr: null, ...extra });
  return { forge, dataDir, repoDir, wt, ctx };
}

function commitFile(wt: Worktree, file: string, content: string, msg: string): string {
  writeFileSync(join(wt.path, file), content);
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-m", msg);
  return git(wt.path, "rev-parse", "HEAD").trim();
}
const rev = (dir: string, ref: string) => git(dir, "rev-parse", ref).trim();

test("分支名：ID 前 8 位加标题 slug；没有可用字符时只用 ID", () => {
  assert.equal(branchBase("abcdef12-3456", "Fix: the BUTTON color!"), "abcdef12-fix-the-button-color");
  assert.equal(branchBase("abcdef12-3456", "修复按钮颜色"), "abcdef12");
});

test("worktree 基于 origin/main，分支为 loop/<名字>，主检出目录不被改动", async () => {
  const { wt, repoDir } = await setup();
  assert.equal(wt.branch, "loop/11111111-fix-the-title");
  assert.equal(wt.base, rev(repoDir, "origin/main"));
  assert.equal(git(repoDir, "status", "--porcelain").trim(), "", "主检出目录必须保持干净");
  assert.equal(git(repoDir, "branch", "--show-current").trim(), "main");
});

test("智能体留下的未提交改动由守护进程替它提交；干净时不提交", async () => {
  const { wt } = await setup();
  assert.equal(await commitLeftovers(wt, "x"), false);
  writeFileSync(join(wt.path, "new.txt"), "n\n");
  assert.equal(await commitLeftovers(wt, "loop: 任务"), true);
  assert.equal(git(wt.path, "status", "--porcelain").trim(), "");
  assert.match(git(wt.path, "log", "-1", "--format=%s"), /loop: 任务/);
});

test("没有提交时不推送、不建 PR（例如方案轮）", async () => {
  const { forge, ctx } = await setup();
  assert.equal(await publishBranch(ctx()), null);
  assert.equal(forge.prs.length, 0);
  assert.equal(forge.remoteHead("loop/11111111-fix-the-title"), null);
});

test("有提交：推送分支并创建 PR；续改再推送时是强推，且不会重复建 PR", async () => {
  const { forge, wt, ctx } = await setup();
  const h1 = commitFile(wt, "a.txt", "hello\nchange1\n", "c1");
  const first = await publishBranch(ctx());
  assert.equal(first!.created, true);
  assert.equal(first!.head, h1);
  assert.equal(forge.remoteHead(wt.branch), h1);
  assert.equal(forge.prs.length, 1);
  assert.equal(forge.prs[0].base, "main");
  // 续改：追加提交，PR 沿用
  const h2 = commitFile(wt, "a.txt", "hello\nchange1\nchange2\n", "c2");
  const second = await publishBranch(ctx({ pr: first!.pr }));
  assert.equal(second!.created, false);
  assert.equal(second!.pr.number, first!.pr.number);
  assert.equal(forge.remoteHead(wt.branch), h2);
  assert.equal(forge.prs.length, 1, "不能重复建 PR");
});

test("最常见路径：批准的提交被合并，主分支历史只来自合并的 PR", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  const p = await publishBranch(ctx());
  const r = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(r.outcome, "merged");
  if (r.outcome !== "merged") return;
  assert.equal(r.mergeSha, rev(repoDir, "origin/main"), "合并提交就是主分支的最新提交");
  assert.equal(forge.mergeCalls, 1);
  // 主分支上的提交只有：初始提交 + 合并 PR 的一次 squash 提交
  const log = git(forge.origin, "log", "main", "--format=%s").trim().split("\n");
  assert.equal(log.length, 2);
  assert.match(log[0], /Fix the title \(#1\)/);
});

test("审核期间主分支前进：自动 merge 并更新 PR，但必须重新审核，不会直接合并", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  const p = await publishBranch(ctx());
  forge.advanceMain("other.txt", "from main\n");
  const r1 = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(r1.outcome, "review_needed");
  assert.equal(forge.mergeCalls, 0, "提交变了不能合并");
  const h2 = rev(wt.path, "HEAD");
  assert.notEqual(h2, h);
  assert.equal(forge.remoteHead(wt.branch), h2, "PR 分支已被强推更新");
  assert.ok(existsSync(join(wt.path, "other.txt")), "已包含主分支的新改动");
  // 重新审核、批准新的提交后合并成功
  const r2 = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h2 });
  assert.equal(r2.outcome, "merged");
});

test("主分支改了同一行：冲突交回原会话处理，不能重复要求批准", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "task edit\n", "c1");
  const p = await publishBranch(ctx());
  forge.advanceMain("a.txt", "main edit\n");
  const r = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(r.outcome, "sync_conflict");
  assert.match((r as { detail: string }).detail, /git merge --no-edit origin\/main/);
  assert.match((r as { detail: string }).detail, /不要使用 rebase/);
  assert.equal(rev(wt.path, "HEAD"), h, "冲突后分支不能被改动");
  assert.equal(git(wt.path, "status", "--porcelain").trim(), "");
  assert.equal(forge.mergeCalls, 0);
  assert.throws(() => git(wt.path, "merge", "--no-edit", "origin/main"));
  writeFileSync(join(wt.path, "a.txt"), "task edit and main edit\n");
  git(wt.path, "add", "a.txt");
  git(wt.path, "commit", "-m", "resolve conflict");
  const resolved = rev(wt.path, "HEAD");
  await publishBranch(ctx({ pr: p!.pr }));
  forge.advanceMain("later.txt", "later\n");
  const updated = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: resolved });
  assert.equal(updated.outcome, "review_needed", "新的合并提交需要审核，但旧冲突不能重现");
  const approved = rev(wt.path, "HEAD");
  const merged = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: approved });
  assert.equal(merged.outcome, "merged", "再次批准之后必须合并成功");
  assert.equal(git(forge.origin, "show", "main:a.txt"), "task edit and main edit\n");
});

test("远端分支在审核之后被改动：合并被拒绝（只合并审核过的提交）", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  const p = await publishBranch(ctx());
  // 审核之后有人往 PR 分支又推了一个提交（本地 head 仍是 h，但远端已变）
  const other = join(tempDir("loopd-evil-"), "c");
  git(tempDir("loopd-x-"), "clone", forge.origin, other);
  git(other, "config", "user.email", "e@x");
  git(other, "config", "user.name", "evil");
  git(other, "checkout", wt.branch);
  writeFileSync(join(other, "evil.txt"), "x\n");
  git(other, "add", "-A");
  git(other, "commit", "-m", "evil");
  git(other, "push", "origin", wt.branch);
  const r = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(r.outcome, "failed");
  assert.match((r as { detail: string }).detail, /head 已变化|拒绝/);
  assert.equal(git(forge.origin, "log", "main", "--format=%s").trim().split("\n").length, 1, "主分支不应有任何新提交");
});

test("PR 已被关闭：不合并，明确失败", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  const p = await publishBranch(ctx());
  forge.prs[0].state = "CLOSED";
  const r = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(r.outcome, "failed");
  assert.match((r as { detail: string }).detail, /已被关闭/);
});

test("上次合并后崩溃：PR 已合并，再次发布按已合并继续，不重复合并", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  const h = commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  const p = await publishBranch(ctx());
  await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  const again = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", prNumber: p!.pr.number, approvedSha: h });
  assert.equal(again.outcome, "merged");
  assert.equal(forge.mergeCalls, 1, "不能重复合并");
});

test("合并后清理：worktree、本地分支、远端分支都被移除", async () => {
  const { forge, wt, repoDir, ctx } = await setup();
  commitFile(wt, "a.txt", "hello\nchange\n", "c1");
  await publishBranch(ctx());
  assert.ok(forge.remoteHead(wt.branch));
  await cleanupTask(forge, repoDir, wt);
  assert.equal(existsSync(wt.path), false);
  assert.equal(git(repoDir, "branch", "--list", wt.branch).trim(), "");
  assert.equal(forge.remoteHead(wt.branch), null);
});

test("两个并发任务：各自独立分支与 PR，先后合并后主分支包含两者，互不覆盖", async () => {
  const forge = new FakeForge();
  const dataDir = tempDir("loopd-pr-");
  const repoDir = await forge.ensureCheckout({ githubRepo: REPO, dataDir });
  const mk = async (id: string, title: string, file: string) => {
    const wt = await createWorktree({ repo: repoDir, dataDir, taskId: id, mainRef: "origin/main", name: branchBase(id, title) });
    const h = commitFile(wt, file, `${title}\n`, title);
    const base = { forge, githubRepo: REPO, repoDir, wt, mainBranch: "main", title, body: "", pr: null };
    const p = await publishBranch(base);
    return { wt, h, p: p!, base };
  };
  const t1 = await mk("aaaaaaaa-1", "Task one", "one.txt");
  const t2 = await mk("bbbbbbbb-2", "Task two", "two.txt");
  assert.notEqual(t1.wt.branch, t2.wt.branch);
  assert.equal(forge.prs.length, 2);
  // 先合并 t1；t2 随后发现主分支前进，merge 后需要重新审核，再合并
  const m1 = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt: t1.wt, mainBranch: "main", prNumber: t1.p.pr.number, approvedSha: t1.h });
  assert.equal(m1.outcome, "merged");
  const m2a = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt: t2.wt, mainBranch: "main", prNumber: t2.p.pr.number, approvedSha: t2.h });
  assert.equal(m2a.outcome, "review_needed");
  const m2b = await syncAndMerge({ forge, githubRepo: REPO, repoDir, wt: t2.wt, mainBranch: "main", prNumber: t2.p.pr.number, approvedSha: rev(t2.wt.path, "HEAD") });
  assert.equal(m2b.outcome, "merged");
  const files = git(forge.origin, "ls-tree", "-r", "--name-only", "main").trim().split("\n");
  assert.ok(files.includes("one.txt") && files.includes("two.txt"), `主分支应同时包含两个任务的改动：${files}`);
  assert.equal(readFileSync(join(repoDir, "a.txt"), "utf8"), "hello\n");
});

test("驳回或取消：关闭 PR，清理 worktree 与本地、远端分支，主分支不受影响", async () => {
  const { forge, repoDir, wt, ctx } = await setup();
  commitFile(wt, "a.txt", "x\n", "change");
  const pub = await publishBranch(ctx())!;
  const mainBefore = rev(repoDir, "origin/main");
  await retireBranch({ forge, githubRepo: REPO, repoDir, wt, pr: pub!.pr, comment: "驳回" });
  assert.equal(forge.prs[0].state, "CLOSED", "PR 已关闭，不是合并");
  assert.equal(existsSync(wt.path), false, "worktree 已删除");
  assert.equal(git(repoDir, "branch", "--list", wt.branch).trim(), "", "本地分支已删除");
  assert.equal(await forge.remoteHead(wt.branch), null, "远端分支已删除");
  assert.equal(rev(repoDir, "origin/main"), mainBefore, "主分支没有变化");
});

test("驳回时没有 PR（只出过方案）也能收尾", async () => {
  const { forge, repoDir, wt } = await setup();
  await retireBranch({ forge, githubRepo: REPO, repoDir, wt, pr: null, comment: "驳回" });
  assert.equal(existsSync(wt.path), false);
  assert.equal(forge.prs.length, 0);
});
