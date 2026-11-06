import test from "node:test";
import assert from "node:assert/strict";
import { GitLabForge, parseRemoteUrl } from "./forge.ts";

test("解析远端地址：scp、ssh、http(s) 与本地路径", () => {
  assert.deepEqual(parseRemoteUrl("git@github.com:o/r.git"), {
    host: "github.com",
    path: "o/r",
    protocol: "https",
  });
  assert.deepEqual(
    parseRemoteUrl("http://git.example.com/eval/Evaluation.git"),
    { host: "git.example.com", path: "eval/Evaluation", protocol: "http" },
  );
  assert.deepEqual(
    parseRemoteUrl("ssh://git@gitlab.example.com:2222/group/sub/repo.git"),
    {
      host: "gitlab.example.com",
      path: "group/sub/repo",
      protocol: "https",
    },
  );
  assert.equal(parseRemoteUrl("/tmp/fakeorigin/repo.git"), null);
  assert.equal(parseRemoteUrl(""), null);
});

function fakeGitLab(
  routes: Record<string, { status?: number; body: unknown }>,
) {
  const calls: { method: string; url: string; body: unknown }[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url: String(url),
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const match = Object.entries(routes).find(([key]) =>
      String(url).includes(key),
    );
    const hit = match?.[1] ?? { status: 404, body: { message: "not found" } };
    return new Response(JSON.stringify(hit.body), {
      status: hit.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

test("自建 GitLab：建 MR、按提交合并、状态映射与关闭", async () => {
  const created = {
    iid: 7,
    web_url: "http://gitlab.local/eval/Evaluation/-/merge_requests/7",
    state: "opened",
    sha: "head1",
    merge_commit_sha: null as string | null,
  };
  const calls: { method: string; url: string; body: unknown }[] = [];
  let mrState = "opened";
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ method, url: String(url), body });
    const u = String(url);
    if (method === "POST" && u.endsWith("/merge_requests")) {
      return Response.json(created);
    }
    if (method === "PUT" && u.endsWith("/merge_requests/7/merge")) {
      mrState = "merged";
      return Response.json({});
    }
    if (method === "POST" && u.endsWith("/notes")) return Response.json({});
    if (u.includes("/merge_requests?")) return Response.json([]);
    return Response.json({
      ...created,
      state: mrState,
      merge_commit_sha: mrState === "merged" ? "merged1" : null,
    });
  }) as unknown as typeof fetch;
  const forge = new GitLabForge({
    host: "gitlab.local",
    protocol: "http",
    token: "glpat-test",
    fetchImpl,
  });

  const pr = await forge.createPr({
    githubRepo: "eval/Evaluation",
    base: "main",
    head: "task-1",
    title: "标题",
    body: "说明",
    cwd: "/tmp",
  });
  assert.deepEqual(pr, {
    number: 7,
    url: "http://gitlab.local/eval/Evaluation/-/merge_requests/7",
  });
  const createCall = calls.find(
    (c) => c.method === "POST" && c.url.endsWith("/merge_requests"),
  );
  assert.ok(
    createCall?.url.endsWith("/api/v4/projects/eval%2FEvaluation/merge_requests"),
  );
  assert.deepEqual(createCall?.body, {
    source_branch: "task-1",
    target_branch: "main",
    title: "标题",
    description: "说明",
    remove_source_branch: false,
  });

  const merged = await forge.mergePr({
    githubRepo: "eval/Evaluation",
    number: 7,
    matchHead: "head1",
    cwd: "/tmp",
  });
  assert.equal(merged.ok, true);
  const mergeCall = calls.find((c) => c.url.endsWith("/merge_requests/7/merge"));
  assert.deepEqual(mergeCall?.body, {
    sha: "head1",
    should_remove_source_branch: false,
  });

  const info = await forge.prInfo({
    githubRepo: "eval/Evaluation",
    number: 7,
    cwd: "/tmp",
  });
  assert.deepEqual(info, { state: "MERGED", mergeSha: "merged1" });

  await forge.closePr({
    githubRepo: "eval/Evaluation",
    number: 7,
    comment: "驳回",
    cwd: "/tmp",
  });
  // 已合并的 MR 不重复关闭
  assert.ok(
    !calls.some((c) => c.method === "PUT" && c.url.endsWith("/merge_requests/7")),
  );
});

test("自建 GitLab：提交已变化时拒绝合并", async () => {
  const { fetchImpl } = fakeGitLab({
    "/merge_requests/3": {
      body: {
        iid: 3,
        web_url: "http://gitlab.local/x/-/merge_requests/3",
        state: "opened",
        sha: "changed",
        merge_commit_sha: null,
      },
    },
  });
  const forge = new GitLabForge({
    host: "gitlab.local",
    token: "glpat-test",
    fetchImpl,
  });
  const r = await forge.mergePr({
    githubRepo: "eval/Evaluation",
    number: 3,
    matchHead: "approved",
    cwd: "/tmp",
  });
  assert.equal(r.ok, false);
  assert.match(r.output, /提交已变/);
});

test("缺少 GITLAB_TOKEN 时给出可操作的错误", () => {
  const saved = process.env.GITLAB_TOKEN;
  delete process.env.GITLAB_TOKEN;
  try {
    assert.throws(
      () => new GitLabForge({ host: "gitlab.local" }),
      /GITLAB_TOKEN/,
    );
  } finally {
    if (saved !== undefined) process.env.GITLAB_TOKEN = saved;
  }
});
