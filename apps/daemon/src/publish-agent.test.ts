import { test, after } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWorktree } from "./worktree.ts";
import { LoopDaemon } from "./daemon.ts";
import { publishPrompt, PublishUnavailableError, runPublishInSession, syncToMergedMain } from "./publish-agent.ts";
import { FAKE_SPEC, git, makeRepo, tempDir } from "./testing/fixtures.ts";

test("发布前把工作树对齐到合并后的主分支（任务分支的提交被主分支取代）", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-pub-"), taskId: "p1", mainRef: "main" });
  writeFileSync(join(wt.path, "feature.txt"), "x");
  git(wt.path, "add", "-A");
  git(wt.path, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "feature");
  // 模拟 squash 合并后主分支前进：origin/main 指向另一个提交
  git(repo, "update-ref", "refs/remotes/origin/main", "main");
  writeFileSync(join(repo, "merged.txt"), "squashed");
  git(repo, "add", "-A");
  git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-m", "squash merge");
  const mergeSha = git(repo, "rev-parse", "HEAD").trim();
  git(repo, "update-ref", "refs/remotes/origin/main", mergeSha);
  await syncToMergedMain(wt, "main", mergeSha);
  assert.equal(git(wt.path, "rev-parse", "HEAD").trim(), mergeSha);
  assert.equal(git(wt.path, "status", "--porcelain").trim(), "");
});

test("合并提交不在主分支上：明确报错", async () => {
  const repo = makeRepo();
  const wt = await createWorktree({ repo, dataDir: tempDir("loopd-pub-"), taskId: "p2", mainRef: "main" });
  git(repo, "update-ref", "refs/remotes/origin/main", "main");
  await assert.rejects(() => syncToMergedMain(wt, "main", "0".repeat(40)), /无法发布/);
});

test("发布提示：指向 AGENTS.md，不猜发布方式", () => {
  const p = publishPrompt("abcdef123456", "main");
  assert.match(p, /AGENTS\.md/);
  assert.match(p, /不要猜/);
  assert.match(p, /abcdef12/);
  assert.match(p, /可以自行解决/);
  assert.match(p, /不可逆的数据删除\/覆盖/);
  assert.match(p, /需要人工/);
});

test("主分支已前进时，发布目标是当前 HEAD 而不是旧的合并提交", () => {
  const p = publishPrompt("e8256dfb1234", "main", "42e9b0f1b981");
  assert.match(p, /HEAD e8256dfb/);
  assert.match(p, /包含本任务的合并提交 42e9b0f1/);
  assert.match(p, /发布目标是当前 HEAD（e8256dfb1234）/);
  assert.doesNotMatch(p, /不再在任务分支上/);
});

const daemons: LoopDaemon[] = [];
after(async () => {
  for (const d of daemons) await d.close();
});

test("对原来的会话发“开始发布”：同一个会话收到消息、跑完一轮并取回回复；会话没在运行会先恢复", async () => {
  const d = new LoopDaemon({ dataDir: tempDir("loopd-pub-"), specs: { fake: FAKE_SPEC } });
  daemons.push(d);
  const id = await d.start({ taskId: "p3", repo: makeRepo(), agent: "fake", prompt: "你好" });
  assert.equal((await d.waitFor(id)).state, "idle");
  const r = await runPublishInSession(d, id, "发布吧", 30_000);
  assert.equal(r.state, "idle");
  assert.ok(r.reply.length > 0, "应取回智能体的回复");
  assert.ok(d.store.read(id).some((e) => e.kind === "message" && (e.payload as { role: string; text: string }).role === "user" && (e.payload as { text: string }).text === "发布吧"), "消息发到了原会话");
  // 进程没在运行（例如守护进程重启后或会话已被关闭）：先 resume 再发布
  await d.cancel(id);
  assert.equal(d.store.getMeta(id)!.state, "cancelled");
  const again = await runPublishInSession(d, id, "再发布", 30_000);
  assert.equal(again.state, "idle");
  assert.ok(again.reply.length > 0);
});

test("发布会话不在空闲状态：给出可识别的中断错误，供网关转成待确认发布", async () => {
  const d = new LoopDaemon({ dataDir: tempDir("loopd-pub-"), specs: { fake: FAKE_SPEC } });
  daemons.push(d);
  const id = await d.start({ taskId: "p4", repo: makeRepo(), agent: "fake", prompt: "你好" });
  await d.waitFor(id);
  d.store.updateMeta(id, { state: "needs_you" });
  await assert.rejects(
    () => runPublishInSession(d, id, "发布吧", 30_000),
    (e: unknown) => e instanceof PublishUnavailableError && e.state === "needs_you",
  );
});

test("人重试已合并的发布：重启留下的 crashed/needs_you 不再拦住发布", async () => {
  const d = new LoopDaemon({ dataDir: tempDir("loopd-pub-"), specs: { fake: FAKE_SPEC } });
  daemons.push(d);
  const id = await d.start({ taskId: "p5", repo: makeRepo(), agent: "fake", prompt: "你好" });
  await d.waitFor(id);
  await d.cancel(id);
  d.store.updateMeta(id, { state: "needs_you" });
  const r = await runPublishInSession(d, id, "重试发布", 30_000, { resetWaiting: true });
  assert.equal(r.state, "idle");
  assert.ok(r.reply.length > 0);
});

test("发布结论：取最后一条“发布结果：成功/失败”，没有就是 unclear（不猜）", async () => {
  const { parseVerdict } = await import("./publish-agent.ts");
  assert.deepEqual(parseVerdict("已部署到 https://x\n发布结果：成功"), { verdict: "success", summary: "已部署到 https://x" });
  const f = parseVerdict("构建失败\n发布结果：失败（wrangler 报错）");
  assert.equal(f.verdict, "failure");
  assert.match(f.summary, /wrangler 报错/);
  assert.equal(parseVerdict("**发布结果：成功**").verdict, "success", "容忍加粗");
  assert.equal(parseVerdict("发布结果：失败（旧的）\n后来重试了\n发布结果：成功").verdict, "success", "以最后一条为准");
  assert.equal(parseVerdict("应该部署好了吧").verdict, "unclear");
  assert.equal(parseVerdict("").verdict, "unclear");
});
