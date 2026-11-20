import type { DeliverySettings, DeliveryStage, DeliveryState, Stage, TestEnvironment } from "@loop/core";
import type { Forge, PrRef } from "./forge.ts";
import { git, type Worktree } from "./worktree.ts";
import { syncAndMerge } from "./pr-flow.ts";

export interface DeliveryStep {
  next: Stage;
  state: DeliveryState;
  delay?: boolean;
  error?: string;
  repair?: string;
}

interface DeliveryContext {
  stage: DeliveryStage;
  state: DeliveryState;
  settings: DeliverySettings;
  forge: Forge;
  githubRepo: string;
  repoDir: string;
  wt: Worktree;
  prNumber: number | null;
  head: string | null;
  candidates: () => Promise<{ id: string; round: number; title: string; sha: string }[]>;
  test: (prompt: string) => Promise<{ passed: boolean; output: string }>;
  check: () => Promise<void>;
  active: () => boolean;
}

const contains = async (cwd: string, from: string, to: string) => git(cwd, "merge-base", "--is-ancestor", from, to).then(() => true, () => false);
async function ref(cwd: string, branch: string) {
  return (await git(cwd, "rev-parse", `origin/${branch}`)).trim();
}

export async function advanceDelivery(ctx: DeliveryContext): Promise<DeliveryStep> {
  const { state, stage, settings, forge, githubRepo, repoDir, wt } = ctx;
  const step = (next: Stage = stage, data: DeliveryState = {}, rest: Partial<DeliveryStep> = {}): DeliveryStep => ({ next, state: data, ...rest });
  const fetch = () => forge.fetch(repoDir);
  if (state.productionMerge && ["preview_deploy", "preview_test", "production_review"].includes(stage)) return step("production_deploy", { productionMerge: state.productionMerge, release: state.release });
  if (stage === "preview_deploy" && !state.previewMerge) {
    if (!ctx.prNumber || !ctx.head) throw new Error("缺少任务 PR/MR 或提交");
    let head = ctx.head;
    for (let attempt = 0; attempt < 3 && ctx.active(); attempt++) {
      const merged = await syncAndMerge({ forge, githubRepo, repoDir, wt, mainBranch: "dev", prNumber: ctx.prNumber, approvedSha: head, beforeMerge: () => {
        if (!ctx.active()) throw new Error("任务租约已失效");
      } });
      if (merged.outcome === "merged") return step(stage, { previewMerge: merged.mergeSha });
      if (merged.outcome === "sync_conflict") return step("running", {}, { repair: merged.detail.replace("交给用户重新审核", "验证后自动合入 dev") });
      if (merged.outcome === "failed") throw new Error(merged.detail);
      await ctx.check();
      head = (await git(wt.path, "rev-parse", "HEAD")).trim();
    }
    return step(stage, {}, { delay: true });
  }
  if (stage === "preview_deploy" || (stage === "production_deploy" && state.productionMerge)) {
    const preview = stage === "preview_deploy";
    const branch = preview ? "dev" : "main";
    const sha = (preview ? state.previewMerge : state.productionMerge)!;
    const environment = preview ? settings.preview : settings.production;
    const query = { githubRepo, branch, cwd: repoDir, workflow: environment.workflow };
    if (!forge.pipeline) throw new Error("当前代码托管平台无法查询流水线");
    await fetch();
    const latest = await ref(repoDir, branch);
    const candidate = await contains(repoDir, sha, latest) ? latest : sha;
    let run = await forge.pipeline({ ...query, sha: candidate });
    let deployedSha = candidate;
    if (!run && candidate !== sha) {
      run = await forge.pipeline({ ...query, sha });
      deployedSha = sha;
    }
    const data = preview ? { previewRun: run, previewSha: deployedSha } : { productionRun: run, productionSha: deployedSha };
    if (!run || run.status === "pending") return step(stage, data, { delay: true });
    if (run.status !== "success") return step(stage, data, { error: `部署流水线${{ failed: "失败", cancelled: "已取消", skipped: "已跳过" }[run.status]}。流水线重跑后，在 Loop 点击重试。` });
    return step(preview ? "preview_test" : "production_test", data);
  }
  if (stage === "preview_test" || stage === "production_test") {
    const preview = stage === "preview_test";
    const branch = preview ? "dev" : "main";
    const sha = (preview ? state.previewSha : state.productionSha)!;
    const environment = preview ? settings.preview : settings.production;
    const moved = async () => {
      await fetch();
      const latest = await ref(repoDir, branch);
      if (latest === sha || !await contains(repoDir, sha, latest)) return false;
      return (await forge.pipeline?.({ githubRepo, branch, sha: latest, workflow: environment.workflow, cwd: repoDir }))?.status === "success";
    };
    if (await moved()) return step(preview ? "preview_deploy" : "production_deploy");
    if (!ctx.active()) throw new Error("任务租约已失效");
    await git(wt.path, "reset", "--hard", sha);
    if (!ctx.active()) throw new Error("任务租约已失效");
    const result = await ctx.test(environmentPrompt(preview, environment, sha));
    if (await moved()) return step(preview ? "preview_deploy" : "production_deploy", preview ? { previewResult: result.output } : { productionResult: result.output });
    const data = preview ? { previewResult: result.output, previewPassed: result.passed } : { productionResult: result.output };
    if (!result.passed) {
      if (preview && result.output) return step("running", { ...data, previewMerge: null }, { repair: `预览测试失败。请基于最新 dev 修复并完成项目检查，再提交改动。\n${result.output}` });
      return step(stage, data, { error: result.output || "智能体没有返回明确的测试通过结果" });
    }
    return step(preview ? "production_review" : "published", data);
  }

  await fetch();
  const dev = await ref(repoDir, "dev");
  const scope = { githubRepo, cwd: repoDir };
  if (stage === "production_deploy") {
    const release = state.release;
    if (!release || !state.productionApproval) return step("production_review");
    let pr = await forge.prInfo({ ...scope, number: release.number });
    if (pr.state === "OPEN") {
      if (dev !== state.productionApproval) return step("production_review", { productionApproval: null, release: null });
      if (!ctx.active()) throw new Error("任务租约已失效");
      const merged = await forge.mergePr({ ...scope, number: release.number, matchHead: state.productionApproval, preserveHistory: true });
      pr = await forge.prInfo({ ...scope, number: release.number });
      if (pr.state !== "MERGED") {
        await fetch();
        if (await ref(repoDir, "dev") !== state.productionApproval) return step("production_review", { productionApproval: null, release: null });
        return step("production_review", { productionApproval: null }, { error: merged.output || "生产 PR/MR 尚未合并" });
      }
    }
    if (pr.state !== "MERGED" || !pr.mergeSha) return step("production_review", { productionApproval: null, release: null });
    const head = pr.head ?? state.productionApproval;
    if (head !== state.productionApproval) {
      return step("production_review", { productionApproval: null }, { error: "该 PR/MR 已合入不同的源提交，请确认托管平台上的发布记录" });
    }
    const tasks = await included(ctx, head);
    return step(stage, { productionMerge: pr.mergeSha, release: { ...release, head, tasks } });
  }

  if (state.release) {
    const pr = await forge.prInfo({ ...scope, number: state.release.number });
    if (pr.state === "MERGED" && pr.mergeSha && await contains(repoDir, state.previewMerge!, pr.head ?? state.release.head)) {
      const head = pr.head ?? state.release.head;
      return step("production_deploy", { productionMerge: pr.mergeSha, release: { ...state.release, head, tasks: await included(ctx, head) } });
    }
  }
  let pr: PrRef | null = await forge.findPr({ ...scope, head: "dev", base: "main" });
  const tasks = await included(ctx, dev);
  if (!pr && ctx.active()) {
    try {
      pr = await forge.createPr({ ...scope, head: "dev", base: "main", title: "发布 dev 到 main", body: "由 Loop 在预览环境测试通过后创建。" });
    } catch (error) {
      pr = await forge.findPr({ ...scope, head: "dev", base: "main" });
      if (!pr) throw error;
    }
  }
  return step(stage, { release: pr ? { ...pr, head: dev, tasks } : null }, { delay: true });
}

async function included(ctx: DeliveryContext, head: string) {
  const tasks = await ctx.candidates();
  const matched = await Promise.all(tasks.map(async ({ sha, ...task }) => (await contains(ctx.repoDir, sha, head)) ? task : null));
  return matched.filter((task) => task !== null);
}

function environmentPrompt(preview: boolean, env: TestEnvironment, sha: string) {
  return [
    `${preview ? "预览" : "生产"}环境流水线已成功，版本 ${sha}。请按 AGENTS.md 和项目文档执行${preview ? "预览测试" : "生产回归测试"}。本轮只测试，修复、提交和发布由后续流程处理。`,
    JSON.stringify({ url: env.url, username: env.username, password: env.password }),
    "说明测试步骤和结果，最后一行写「测试结果：通过」或「测试结果：失败」。无法完成测试时也要说明具体原因。",
  ].join("\n\n");
}
