import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverAgents, listClaudeSessions } from "./discovery.ts";
import { tempDir } from "./testing/fixtures.ts";

test("发现结果覆盖支持的工具（claude、codex、grok、opencode、pi、dsh），且每项有明确的安装与驱动状态", async () => {
  const list = await discoverAgents();
  assert.deepEqual(list.map((a) => a.kind), ["claude", "codex", "grok", "opencode", "pi", "dsh"]);
  for (const a of list) {
    assert.equal(typeof a.installed, "boolean");
    if (!a.installed) assert.ok(a.note, `${a.kind} 未安装时必须说明原因`);
  }
});

test("Claude 历史会话：只读解析会话 ID、工作目录与标题，不修改文件", () => {
  const home = tempDir("loopd-home-");
  const dir = join(home, ".claude", "projects", "-x-project");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "abc-123.jsonl");
  writeFileSync(file, [JSON.stringify({ type: "user", cwd: "/x/project", message: { content: "请帮我改按钮颜色" } }), JSON.stringify({ type: "assistant" })].join("\n") + "\n");
  const before = readFileSync(file, "utf8");
  const list = listClaudeSessions(10, home);
  assert.equal(list.length, 1);
  assert.equal(list[0].id, "abc-123");
  assert.equal(list[0].cwd, "/x/project");
  assert.equal(list[0].title, "请帮我改按钮颜色");
  assert.ok(Number.isInteger(list[0].updatedAt), "时间戳必须是整数（Postgres BIGINT）");
  assert.equal(readFileSync(file, "utf8"), before, "只读，不能修改");
});
