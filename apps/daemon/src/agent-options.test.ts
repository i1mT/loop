import { test } from "node:test";
import assert from "node:assert/strict";
import { applyModelConfig, extractChoices, type ConfigOption } from "./agent-options.ts";

const grokInitial: ConfigOption[] = [
  { id: "model", category: "model", currentValue: "magpie/group/group", options: [{ value: "grok-4.7", name: "Grok 4.7" }, { value: "grok-4.5", name: "Grok 4.5" }] },
  { id: "reasoning_effort", category: "thought_level", currentValue: "low", options: [{ value: "low", name: "Low" }, { value: "high", name: "High" }] },
];
const grokAfterModel: ConfigOption[] = [
  grokInitial[0],
  { id: "reasoning_effort", category: "thought_level", currentValue: "low", options: [{ value: "xhigh", name: "x" }, { value: "high", name: "h" }, { value: "medium", name: "m" }, { value: "low", name: "l" }] },
];

function fakeConn(afterModel: ConfigOption[]) {
  const calls: [string, string][] = [];
  return {
    calls,
    async setConfigOption(_sid: string, id: string, value: string) {
      calls.push([id, value]);
      if (id === "fail") throw new Error("boom");
      return id === "model" ? afterModel : undefined;
    },
  };
}

test("提取模型与思考程度选项", () => {
  const c = extractChoices(grokInitial);
  assert.deepEqual(c.models.map((m) => m.value), ["grok-4.7", "grok-4.5"]);
  assert.deepEqual(c.efforts.map((m) => m.value), ["low", "high"]);
  assert.deepEqual(extractChoices(undefined), { models: [], efforts: [] });
});

test("先设模型，再按新模型的选项设思考程度（xhigh 只有换模型后才可用）", async () => {
  const conn = fakeConn(grokAfterModel);
  const notes = await applyModelConfig(conn, "s", grokInitial, { model: "grok-4.7", effort: "xhigh" });
  assert.deepEqual(conn.calls, [["model", "grok-4.7"], ["reasoning_effort", "xhigh"]]);
  assert.deepEqual(notes, ["模型：grok-4.7", "思考程度：xhigh"]);
});

test("不合法的模型或思考程度：不设置、不抛错，说明写清楚", async () => {
  const conn = fakeConn(grokAfterModel);
  const notes = await applyModelConfig(conn, "s", grokInitial, { model: "nope", effort: "max" });
  assert.deepEqual(conn.calls, [], "模型不存在时不调用设置；effort 也无法确认，同样跳过？");
  assert.match(notes[0], /不在该智能体的可选列表里/);
});

test("只设思考程度、不改模型", async () => {
  const conn = fakeConn(grokAfterModel);
  const notes = await applyModelConfig(conn, "s", grokInitial, { effort: "high" });
  assert.deepEqual(conn.calls, [["reasoning_effort", "high"]]);
  assert.deepEqual(notes, ["思考程度：high"]);
});

test("恢复会话时没有初始选项：按约定的选项 ID 尝试", async () => {
  const conn = fakeConn(grokAfterModel);
  await applyModelConfig(conn, "s", undefined, { model: "grok-4.7", effort: "high" });
  assert.deepEqual(conn.calls, [["model", "grok-4.7"], ["reasoning_effort", "high"]]);
});

test("分组的模型列表（dsh）会被展平，值原样保留", () => {
  const dsh: ConfigOption[] = [
    { id: "model", category: "model", currentValue: '["deepseek-official","deepseek-v4-flash"]', options: [{ group: "deepseek-official", name: "DeepSeek", options: [{ value: '["deepseek-official","deepseek-v4-flash"]', name: "deepseek-v4-flash" }, { value: '["deepseek-official","deepseek-v4-pro"]', name: "deepseek-v4-pro" }] }] },
    { id: "reasoning_effort", category: "thought_level", options: [{ value: "off", name: "Off" }, { value: "max", name: "Max" }] },
  ];
  const c = extractChoices(dsh);
  assert.deepEqual(c.models.map((m) => m.name), ["deepseek-v4-flash", "deepseek-v4-pro"]);
  assert.equal(c.models[0].value, '["deepseek-official","deepseek-v4-flash"]');
  assert.deepEqual(c.efforts.map((m) => m.value), ["off", "max"]);
});
