import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorktree, diffAgainstBase, restoreWorktree, startNewRound, syncWithMain } from "./worktree.ts";
import { git, makeRepo, tempDir } from "./testing/fixtures.ts";

test("为任务创建分支与 worktree，基线是主分支当前提交", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "t1", mainRef: "main" });
  assert.equal(wt.branch, "loop/t1");
  assert.ok(existsSync(join(wt.path, "a.txt")));
  assert.equal(git(repo, "rev-parse", "main").trim(), wt.base);
});

test("主分支前进、任务分支无冲突：自动 merge", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "t2", mainRef: "main" });
  writeFileSync(join(wt.path, "task.txt"), "task\n");
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-q", "-m", "task");
  writeFileSync(join(repo, "other.txt"), "main\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "main moves");
  const r = await syncWithMain(wt, repo, "main");
  assert.equal(r.state, "merged");
  assert.ok(existsSync(join(wt.path, "other.txt")), "merge 后应包含主分支的新文件");
});

test("主分支与任务改了同一行：冲突时中止并保持原样", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "t3", mainRef: "main" });
  writeFileSync(join(wt.path, "a.txt"), "task edit\n");
  git(wt.path, "commit", "-qam", "task");
  writeFileSync(join(repo, "a.txt"), "main edit\n");
  git(repo, "commit", "-qam", "main");
  const before = git(wt.path, "rev-parse", "HEAD").trim();
  const r = await syncWithMain(wt, repo, "main");
  assert.equal(r.state, "conflict");
  assert.equal(git(wt.path, "rev-parse", "HEAD").trim(), before, "冲突后分支不能被改动");
  assert.equal(git(wt.path, "status", "--porcelain").trim(), "", "冲突后工作区必须干净");
});

test("工作区有未提交改动：不尝试 merge，返回 dirty", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "t4", mainRef: "main" });
  writeFileSync(join(repo, "other.txt"), "x\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "main moves");
  writeFileSync(join(wt.path, "wip.txt"), "wip\n");
  assert.equal((await syncWithMain(wt, repo, "main")).state, "dirty");
});

test("diff 包含未提交的新建、修改与删除文件", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "t5", mainRef: "main" });
  writeFileSync(join(wt.path, "a.txt"), "changed\n");
  writeFileSync(join(wt.path, "new.txt"), "new\n");
  const files = await diffAgainstBase(wt);
  const byPath = Object.fromEntries(files.map((f) => [f.path, f.change]));
  assert.equal(byPath["a.txt"], "modified");
  assert.equal(byPath["new.txt"], "added");
  assert.match(files.find((f) => f.path === "a.txt")!.patch, /\+changed/);
  assert.equal(readFileSync(join(wt.path, "a.txt"), "utf8"), "changed\n");
});

test("重建工作树：目录还在就什么都不做；分支还在从分支重建", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "r1", mainRef: "main" });
  assert.equal(await restoreWorktree({ repo, wt, prNumber: async () => null }), "exists");
  writeFileSync(join(wt.path, "work.txt"), "work\n");
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-q", "-m", "work");
  const head = git(wt.path, "rev-parse", "HEAD").trim();
  git(repo, "worktree", "remove", "--force", wt.path);
  assert.equal(await restoreWorktree({ repo, wt, prNumber: async () => null }), "restored");
  assert.equal(git(wt.path, "rev-parse", "HEAD").trim(), head);
  assert.equal(readFileSync(join(wt.path, "work.txt"), "utf8"), "work\n");
});

test("重建工作树：取消后分支被删，改从 GitHub 保留的 PR 记录（refs/pull/N/head）找回提交", async () => {
  const repo = makeRepo();
  // 用一个裸仓库当 origin，并像 GitHub 一样把 PR 头提交放在 refs/pull/7/head
  const origin = tempDir("loopd-origin-");
  git(origin, "init", "-q", "--bare");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "r2", mainRef: "main" });
  writeFileSync(join(wt.path, "pr.txt"), "from pr\n");
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-q", "-m", "pr work");
  const head = git(wt.path, "rev-parse", "HEAD").trim();
  git(wt.path, "push", "-q", "origin", `${head}:refs/pull/7/head`);
  // 取消的清理：删工作树与本地分支（远端分支本来就没有）
  git(repo, "worktree", "remove", "--force", wt.path);
  git(repo, "branch", "-D", wt.branch);
  assert.equal(await restoreWorktree({ repo, wt, prNumber: async () => null }), "missing", "没有 PR 编号就找不到");
  assert.equal(await restoreWorktree({ repo, wt, prNumber: async () => 7 }), "restored");
  assert.equal(git(wt.path, "rev-parse", "HEAD").trim(), head);
  assert.equal(git(wt.path, "branch", "--show-current").trim(), wt.branch);
  assert.equal(readFileSync(join(wt.path, "pr.txt"), "utf8"), "from pr\n");
});

test("发布后继续迭代：工作树对齐最新主分支，新基线之上的 diff 只含这一轮的改动", async () => {
  const repo = makeRepo();
  const origin = tempDir("loopd-origin-");
  git(origin, "init", "-q", "--bare");
  git(repo, "remote", "add", "origin", origin);
  git(repo, "push", "-q", "origin", "main");
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "i1", mainRef: "main" });
  // 第 1 轮：改了一个文件，PR 合并（这里用推送到 origin/main 模拟合并），别人也往主分支提交了东西
  writeFileSync(join(wt.path, "round1.txt"), "1\n");
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-q", "-m", "round 1");
  git(wt.path, "push", "-q", "origin", "HEAD:main");
  git(repo, "fetch", "-q", "origin");
  const base = await startNewRound(wt.path, "main");
  assert.equal(git(wt.path, "rev-parse", "origin/main").trim(), base);
  assert.equal(git(wt.path, "rev-parse", "HEAD").trim(), base);
  assert.ok(existsSync(join(wt.path, "round1.txt")), "上一轮已合并的内容在新基线里");
  // 第 2 轮：只改这一轮的文件，diff 里不应出现上一轮的 round1.txt
  writeFileSync(join(wt.path, "round2.txt"), "2\n");
  git(wt.path, "add", "-A");
  git(wt.path, "commit", "-q", "-m", "round 2");
  const diff = await diffAgainstBase({ ...wt, base });
  assert.deepEqual(diff.map((f) => f.path), ["round2.txt"]);
});


test("已通过 merge 解决的历史冲突不能在主分支再次前进时重复出现", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-wt-"), taskId: "resolved", mainRef: "main" });
  writeFileSync(join(wt.path, "a.txt"), "task edit\n");
  git(wt.path, "commit", "-qam", "task");
  writeFileSync(join(repo, "a.txt"), "main edit\n");
  git(repo, "commit", "-qam", "main");
  assert.throws(() => git(wt.path, "merge", "--no-edit", "main"));
  writeFileSync(join(wt.path, "a.txt"), "resolved: task and main\n");
  git(wt.path, "add", "a.txt");
  git(wt.path, "commit", "-qm", "resolve conflict");
  const resolved = git(wt.path, "rev-parse", "HEAD").trim();
  writeFileSync(join(repo, "later.txt"), "later\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "main advances again");
  assert.equal((await syncWithMain(wt, repo, "main")).state, "merged");
  assert.equal(readFileSync(join(wt.path, "a.txt"), "utf8"), "resolved: task and main\n");
  git(wt.path, "merge-base", "--is-ancestor", resolved, "HEAD");
  assert.equal((await syncWithMain(wt, repo, "main")).state, "up_to_date");
});
