import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeploymentRun, DeliveryStage, DeliveryState } from "@loop/core";
import { advanceDelivery, parseEnvironmentTest } from "./delivery.ts";
import { FakeForge } from "./testing/fake-forge.ts";
import { git, tempDir } from "./testing/fixtures.ts";
import { createWorktree } from "./worktree.ts";
import { publishBranch } from "./pr-flow.ts";
import type { PipelineQuery } from "./forge.ts";

class DeploymentForge extends FakeForge {
  runs = new Map<string, DeploymentRun>();
  async pipeline({ branch, sha }: PipelineQuery) {
    return this.runs.get(`${branch}:${sha}`) ?? null;
  }
}

test("测试结论兼容半角冒号和 Markdown，保留失败细节，缺结论时保留原报告", () => {
  assert.deepEqual(parseEnvironmentTest("字号未达到 13px。\n\n测试结果:失败"), { verdict: "failed", output: "字号未达到 13px。" });
  assert.equal(parseEnvironmentTest("**测试结果：通过**\r\n附录").verdict, "passed");
  assert.deepEqual(parseEnvironmentTest("- 测试结果:受阻（缺少预览账号）"), { verdict: "blocked", output: "缺少预览账号" });
  assert.deepEqual(parseEnvironmentTest("测了筛选框，字号不符"), { verdict: "unclear", output: "测了筛选框，字号不符" });
  assert.equal(parseEnvironmentTest("测试结果：通过一部分").verdict, "unclear");
});

test("预览失败修复后重新合入 dev，通过才准备生产 PR", async () => {
  const forge = new DeploymentForge();
  const githubRepo = "example/demo";
  const dataDir = tempDir("loop-delivery-test-");
  const repoDir = await forge.ensureCheckout({ githubRepo, dataDir });
  git(repoDir, "push", "origin", "HEAD:dev");
  await forge.fetch(repoDir);
  const wt = await createWorktree({ repo: repoDir, dataDir, taskId: "one", mainRef: "origin/dev" });
  writeFileSync(join(wt.path, "change.txt"), "change");
  git(wt.path, "add", ".");
  git(wt.path, "commit", "-m", "change");
  const pub = (await publishBranch({ forge, githubRepo, repoDir, wt, mainBranch: "dev", title: "改动", body: "", pr: null }))!;
  const env = { url: "https://example.com", username: "tester", password: "demo password", workflow: "deploy.yml" };
  const tests: string[] = [];
  const settings = { preview: env, production: { ...env, url: "https://prod.example.com" } };
  const candidates = [{ id: "one", round: 1, title: "改动", sha: "" }];
  let currentPr = pub;
  let reply = "字号仍不对。\n测试结果:失败";
  const run = (stage: DeliveryStage, state: DeliveryState) => advanceDelivery({
    stage, state, settings, forge, githubRepo, repoDir, wt, prNumber: currentPr.pr.number, head: currentPr.head,
    candidates: async () => candidates, check: async () => {}, active: () => true,
    test: async (prompt) => { tests.push(prompt); return parseEnvironmentTest(reply); },
  });
  let previewMerge = (await run("preview_deploy", {})).state.previewMerge!;
  candidates[0].sha = previewMerge;
  assert.equal(forge.remoteHead("dev"), previewMerge);
  assert.equal((await run("preview_deploy", { previewMerge })).delay, true);
  assert.equal(forge.mergeCalls, 1);
  assert.deepEqual(tests, []);
  const success = { status: "success", id: "1", url: "https://example.com/run/1" } as const;
  forge.runs.set(`dev:${previewMerge}`, success);
  const queued = await run("preview_deploy", { previewMerge });
  assert.equal(queued.next, "preview_test");
  const failed = await run("preview_test", { ...queued.state, previewMerge });
  assert.equal(failed.next, "running");
  assert.match(failed.repair ?? "", /字号仍不对/);
  assert.equal(failed.state.previewMerge, null);
  assert.equal(forge.prs.length, 1);
  assert.match(tests[0], /demo password/);

  await forge.deleteRemoteBranch({ repoDir, branch: wt.branch });
  writeFileSync(join(wt.path, "change.txt"), "fixed");
  git(wt.path, "add", ".");
  git(wt.path, "commit", "-m", "fix preview");
  currentPr = (await publishBranch({ forge, githubRepo, repoDir, wt, mainBranch: "dev", title: "修复", body: "", pr: null }))!;
  previewMerge = (await run("preview_deploy", failed.state)).state.previewMerge!;
  candidates[0].sha = previewMerge;
  assert.equal(forge.remoteHead("dev"), previewMerge);
  assert.equal((await run("preview_deploy", { previewMerge })).delay, true);
  forge.runs.set(`dev:${previewMerge}`, success);
  const retest = await run("preview_deploy", { previewMerge });
  reply = "修复后复测通过。\n测试结果：通过";
  assert.equal((await run("preview_test", { ...retest.state, previewMerge })).next, "production_review");
  const release = (await run("production_review", { previewMerge })).state.release!;
  assert.equal((await run("production_review", { previewMerge })).state.release?.number, release.number);
  assert.equal(forge.mergeCalls, 2);
  assert.equal((await run("production_deploy", { release, productionApproval: "0".repeat(40) })).next, "production_review");
  const prod = (await run("production_deploy", { previewMerge, release, productionApproval: release.head })).state;
  assert.equal(forge.mergeCalls, 3);
  assert.equal(forge.remoteHead("main"), prod.productionMerge);
  forge.runs.set(`main:${prod.productionMerge}`, success);
  const ready = await run("production_deploy", prod);
  assert.equal(ready.next, "production_test");
  assert.equal(forge.mergeCalls, 3);
  assert.equal((await run("production_test", { ...prod, ...ready.state })).next, "published");
  assert.match(tests[2], /https:\/\/prod\.example\.com/);
});
