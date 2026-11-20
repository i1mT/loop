import assert from "node:assert/strict";
import test from "node:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DeploymentRun, DeliveryStage, DeliveryState } from "@loop/core";
import { advanceDelivery } from "./delivery.ts";
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

test("从 dev 部署到生产回归：重启检查点、共享 MR 和过期的合并请求", async () => {
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
  const run = (stage: DeliveryStage, state: DeliveryState) => advanceDelivery({
    stage, state, settings, forge, githubRepo, repoDir, wt, prNumber: pub.pr.number, head: pub.head,
    candidates: async () => candidates, check: async () => {}, active: () => true,
    test: async (prompt) => { tests.push(prompt); return { passed: true, output: "通过" }; },
  });
  const previewMerge = (await run("preview_deploy", {})).state.previewMerge!;
  candidates[0].sha = previewMerge;
  assert.equal(forge.remoteHead("dev"), previewMerge);
  assert.equal((await run("preview_deploy", { previewMerge })).delay, true);
  assert.equal(forge.mergeCalls, 1);
  assert.deepEqual(tests, []);
  const success = { status: "success", id: "1", url: "https://example.com/run/1" } as const;
  forge.runs.set(`dev:${previewMerge}`, success);
  const queued = await run("preview_deploy", { previewMerge });
  assert.equal(queued.next, "preview_test");
  assert.equal((await run("preview_test", { ...queued.state, previewMerge })).next, "production_review");
  assert.match(tests[0], /demo password/);
  const release = (await run("production_review", { previewMerge })).state.release!;
  assert.equal((await run("production_review", { previewMerge })).state.release?.number, release.number);
  assert.equal(forge.mergeCalls, 1);
  assert.equal((await run("production_deploy", { release, productionApproval: "0".repeat(40) })).next, "production_review");
  const prod = (await run("production_deploy", { previewMerge, release, productionApproval: release.head })).state;
  assert.equal(forge.mergeCalls, 2);
  assert.equal(forge.remoteHead("main"), prod.productionMerge);
  forge.runs.set(`main:${prod.productionMerge}`, success);
  const ready = await run("production_deploy", prod);
  assert.equal(ready.next, "production_test");
  assert.equal(forge.mergeCalls, 2);
  assert.equal((await run("production_test", { ...prod, ...ready.state })).next, "published");
  assert.match(tests[1], /https:\/\/prod\.example\.com/);
});
