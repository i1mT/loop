// 守护进程端到端：用假智能体跑完整场景。不调用真实智能体，不花钱。
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { git as gitRun } from "./testing/fixtures.ts";
import { join } from "node:path";
import { LoopDaemon } from "./daemon.ts";
import { FAKE_SPEC, makeRepo, tempDir } from "./testing/fixtures.ts";
import type { SessionEvent } from "@loop/core";

const daemons: LoopDaemon[] = [];
function newDaemon(dataDir: string): LoopDaemon {
  const d = new LoopDaemon({ dataDir, specs: { fake: FAKE_SPEC } });
  daemons.push(d);
  return d;
}
after(async () => {
  for (const d of daemons) await d.close();
});

const kinds = (es: SessionEvent[]) => es.map((e) => e.kind);
const texts = (es: SessionEvent[]) =>
  es
    .filter((e) => e.kind === "message")
    .map((e) => (e.payload as { text: string }).text);

test("worktree 内的编辑自动放行，并生成文件级 diff", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e1",
    repo: makeRepo(),
    agent: "fake",
    prompt: "write:out/hello.txt:hi",
  });
  const m = await d.waitFor(id);
  assert.equal(m.state, "idle");
  const es = d.store.read(id);
  assert.ok(kinds(es).includes("tool"));
  assert.ok(
    es.some(
      (e) =>
        e.kind === "permission_resolved" &&
        (e.payload as { decidedBy: string }).decidedBy === "policy",
    ),
  );
  const diff = es.filter((e) => e.kind === "diff").pop()!;
  assert.equal((diff.payload as { path: string }).path, "out/hello.txt");
  assert.equal((diff.payload as { change: string }).change, "added");
  assert.ok(existsSync(join(m.cwd, "out", "hello.txt")));
  assert.equal(readFileSync(join(m.cwd, "out", "hello.txt"), "utf8"), "hi\n");
});

test("没有任何输出就 end_turn（模型报错被适配器吞掉）：标记为失败并说明原因，而不是当作做完了", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e-silent",
    repo: makeRepo(),
    agent: "fake",
    prompt: "silent",
  });
  const m = await d.waitFor(id);
  assert.equal(m.state, "failed");
  const err = d.store.read(id).find((e) => e.kind === "error")!;
  assert.match(
    (err.payload as { message: string }).message,
    /没有产生任何输出/,
  );
});

test("spec.autoApprove（opencode）：越界编辑也直接放行，不升级为 needs_you", async () => {
  const d = new LoopDaemon({
    dataDir: tempDir("loopd-e2e-"),
    specs: { fake: { ...FAKE_SPEC, autoApprove: true } },
  });
  daemons.push(d);
  const repo = makeRepo();
  const id = await d.start({
    taskId: "e-auto",
    repo,
    agent: "fake",
    prompt: "write:../escape.txt:x",
  });
  const m = await d.waitFor(id);
  assert.equal(m.state, "idle");
  assert.ok(!d.store.read(id).some((e) => e.kind === "needs_you"));
  assert.ok(
    d.store
      .read(id)
      .some(
        (e) =>
          e.kind === "permission_resolved" &&
          (e.payload as { decidedBy: string }).decidedBy === "policy",
      ),
  );
});

test("租约丢失时的本地取消不写“已取消”事件，重新接管后不会把任务取消掉", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e-lost",
    repo: makeRepo(),
    agent: "fake",
    prompt: "hi",
  });
  await d.waitFor(id);
  await d.cancel(id, { local: true });
  assert.equal(d.store.getMeta(id)!.state, "cancelled");
  assert.ok(
    !d.store
      .read(id)
      .some(
        (e) =>
          e.kind === "status" &&
          (e.payload as { state: string }).state === "cancelled",
      ),
    "过期的取消事件不能被转发",
  );
  await d.resume(id);
  assert.equal(d.store.getMeta(id)!.state, "idle");
  const states = d.store
    .read(id)
    .filter((e) => e.kind === "status")
    .map((e) => (e.payload as { state: string }).state);
  assert.ok(!states.includes("cancelled"));
});

test("越界编辑升级为 needs_you，人拒绝后不写入且会话回到空闲", async () => {
  const dataDir = tempDir("loopd-e2e-");
  const d = newDaemon(dataDir);
  const id = await d.start({
    taskId: "e2",
    repo: makeRepo(),
    agent: "fake",
    prompt: "write:../escape.txt:x",
  });
  const m = await d.waitFor(id);
  assert.equal(m.state, "needs_you");
  const req = d.store.read(id).find((e) => e.kind === "permission_request")!;
  const requestId = (req.payload as { requestId: string }).requestId;
  const ny = d.store.read(id).find((e) => e.kind === "needs_you")!;
  assert.equal((ny.payload as { reason: string }).reason, "rule:permission");
  d.answer(id, requestId, "reject");
  assert.equal((await d.waitFor(id)).state, "idle");
  assert.equal(
    existsSync(join(m.cwd, "..", "escape.txt")),
    false,
    "拒绝后不能写入",
  );
  assert.ok(texts(d.store.read(id)).includes("编辑被拒绝"));
});

test("危险命令升级，人允许后继续执行", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e3",
    repo: makeRepo(),
    agent: "fake",
    prompt: "danger",
  });
  assert.equal((await d.waitFor(id)).state, "needs_you");
  const rid = (
    d.store.read(id).find((e) => e.kind === "permission_request")!.payload as {
      requestId: string;
    }
  ).requestId;
  d.answer(id, rid, "allow");
  await d.waitFor(id);
  assert.ok(texts(d.store.read(id)).includes("已执行"));
  const resolved = d.store
    .read(id)
    .find(
      (e) =>
        e.kind === "permission_resolved" &&
        (e.payload as { decidedBy: string }).decidedBy === "human",
    );
  assert.ok(resolved, "人工决定必须落盘，且标明 decidedBy=human");
});

test("取消会结束整组进程，包括孙进程", async () => {
  const dataDir = tempDir("loopd-e2e-");
  const pidFile = join(dataDir, "gc.pid");
  process.env.FAKE_PID_FILE = pidFile;
  try {
    const d = newDaemon(dataDir);
    const id = await d.start({
      taskId: "e4",
      repo: makeRepo(),
      agent: "fake",
      prompt: "sleep",
    });
    for (let i = 0; i < 100 && !existsSync(pidFile); i++)
      await new Promise((r) => setTimeout(r, 50));
    const gcPid = Number(readFileSync(pidFile, "utf8"));
    await d.cancel(id);
    assert.equal((await d.waitFor(id)).state, "cancelled");
    await new Promise((r) => setTimeout(r, 300));
    assert.throws(() => process.kill(gcPid, 0), /ESRCH/, "孙进程必须已经结束");
  } finally {
    delete process.env.FAKE_PID_FILE;
  }
});

test("智能体进程崩溃 → crashed，恢复后可继续，且历史重放不落盘", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e5",
    repo: makeRepo(),
    agent: "fake",
    prompt: "crash",
  });
  assert.equal((await d.waitFor(id)).state, "crashed");
  await d.resume(id);
  // 崩溃时权限请求已丢失：恢复后停在 needs_you，等人回复
  assert.equal((await d.waitFor(id)).state, "needs_you");
  d.reply(id, "继续");
  await d.waitFor(id);
  const all = texts(d.store.read(id));
  assert.ok(all.includes("回显：继续"));
  assert.equal(
    all.filter((t) => t === "（历史重放）").length,
    0,
    "恢复时的历史重放必须被丢弃",
  );
});

test("守护进程重启后，未结束的会话标为 crashed", async () => {
  const dataDir = tempDir("loopd-e2e-");
  const d1 = newDaemon(dataDir);
  const id = await d1.start({
    taskId: "e6",
    repo: makeRepo(),
    agent: "fake",
    prompt: "write:../x.txt:y",
  });
  assert.equal((await d1.waitFor(id)).state, "needs_you");
  await d1.close();
  const d2 = newDaemon(dataDir);
  assert.deepEqual(d2.recover(), [id]);
  assert.equal(d2.store.getMeta(id)?.state, "crashed");
});

test("主分支前进、无冲突：轮次结束后自动同步，并记录到事件里", async () => {
  const repo = makeRepo();
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e7",
    repo,
    agent: "fake",
    prompt: "commitfile:task.txt:task",
  });
  assert.equal((await d.waitFor(id)).state, "idle");
  // 主分支在任务期间前进（改了另一个文件）
  writeFileSync(join(repo, "other.txt"), "main\n");
  gitRun(repo, "add", "-A");
  gitRun(repo, "commit", "-q", "-m", "main moves");
  d.reply(id, "再来一轮");
  await d.waitFor(id, ["idle"]);
  const m = d.store.getMeta(id)!;
  assert.ok(existsSync(join(m.cwd, "other.txt")), "应已 rebase 到最新主分支");
  assert.ok(
    d.store
      .read(id)
      .some(
        (e) =>
          e.kind === "status" &&
          String((e.payload as { detail?: string }).detail).includes(
            "已自动同步",
          ),
      ),
  );
});

test("主分支前进且改了同一文件：冲突升级为 needs_you，放弃后取消", async () => {
  const repo = makeRepo();
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e8",
    repo,
    agent: "fake",
    prompt: "commitfile:a.txt:task edit",
  });
  assert.equal((await d.waitFor(id)).state, "idle");
  writeFileSync(join(repo, "a.txt"), "main edit\n");
  gitRun(repo, "commit", "-qam", "main edits a.txt");
  d.reply(id, "再来一轮");
  const m = await d.waitFor(id, ["needs_you"]);
  const ny = d.store
    .read(id)
    .filter((e) => e.kind === "needs_you")
    .pop()!;
  assert.equal((ny.payload as { reason: string }).reason, "rule:main-moved");
  assert.equal(m.state, "needs_you");
  await d.resolveNeedsYou(id, "abandon");
  assert.equal((await d.waitFor(id)).state, "cancelled");
});

test("长时间没有输出：升级为 needs_you（卡住），人选择放弃后取消", async () => {
  const d = newDaemon(tempDir("loopd-e2e-"));
  const id = await d.start({
    taskId: "e9",
    repo: makeRepo(),
    agent: "fake",
    prompt: "stall",
  });
  // 等待第一轮真正开始（状态为 running 且有过事件）
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(d.escalateIfStalled(id, 60_000), false, "没有超时不能升级");
  assert.equal(d.escalateIfStalled(id, 1), true, "超时应当升级");
  assert.equal((await d.waitFor(id)).state, "needs_you");
  const ny = d.store
    .read(id)
    .filter((e) => e.kind === "needs_you")
    .pop()!;
  assert.equal((ny.payload as { reason: string }).reason, "rule:stalled");
  await d.resolveNeedsYou(id, "abandon");
  assert.equal((await d.waitFor(id)).state, "cancelled");
});

test("技术方案执行中断保留恢复状态，恢复后的完成轮次清除待执行状态", async () => {
  const d = newDaemon(tempDir("loopd-plan-"));
  const id = await d.start({
    taskId: "plan-recover",
    repo: makeRepo(),
    agent: "fake",
    prompt: "hi",
    analysisOnly: true,
  });
  await d.waitFor(id);
  d.store.updateMeta(id, {
    analysisOnly: false,
    planContinuation: {
      id: "task:1:1",
      attempt: 1,
      status: "pending",
      eventSeq: d.store.lastSeq(id),
    },
  });
  d.reply(id, "crash");
  await d.waitFor(id, ["crashed"]);
  assert.equal(d.store.getMeta(id)?.planContinuation?.recoveryRequired, true);
  await d.resume(id);
  d.store.updateMeta(id, {
    planContinuation: {
      id: "task:1:1",
      attempt: 2,
      status: "pending",
      eventSeq: d.store.lastSeq(id),
    },
  });
  d.reply(id, "hi");
  await d.waitFor(id, ["idle"]);
  assert.equal(d.store.getMeta(id)?.planContinuation?.status, "completed");
});
