// 智能体的模型与思考程度：通过 ACP 的 configOptions 读取可选项并设置。
// 各智能体（claude、codex、grok、opencode、pi、dsh）都有 category=model 与 category=thought_level 两个选项；
// 思考程度的可选值随当前模型变化，所以先设模型，再用返回的新选项设思考程度。
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConn, type AgentSpec } from "./acp/agent-conn.ts";

export interface Choice {
  value: string;
  name: string;
}
/** 选项可以是平铺的，也可以是分组的（dsh 的模型列表按提供方分组） */
export type ChoiceOrGroup = Choice | { group: string; name?: string; options: Choice[] };
export interface ConfigOption {
  id: string;
  category?: string;
  currentValue?: string;
  options?: ChoiceOrGroup[];
}

/** 展开分组，得到平铺的候选值 */
export function flattenChoices(options: ChoiceOrGroup[] | undefined): Choice[] {
  const out: Choice[] = [];
  for (const c of options ?? []) {
    if (c && "options" in c && Array.isArray(c.options)) out.push(...flattenChoices(c.options));
    else if (c && typeof (c as Choice).value === "string") out.push({ value: (c as Choice).value, name: (c as Choice).name ?? (c as Choice).value });
  }
  return out;
}
export interface AgentOptions {
  models: Choice[];
  efforts: Choice[];
}

const byCategory = (opts: ConfigOption[] | undefined, category: string) => (opts ?? []).find((o) => o.category === category);

/** 从 session/new（或设置后的响应）里取出模型与思考程度的可选值 */
export function extractChoices(configOptions: ConfigOption[] | undefined): AgentOptions {
  return { models: flattenChoices(byCategory(configOptions, "model")?.options), efforts: flattenChoices(byCategory(configOptions, "thought_level")?.options) };
}

export interface ModelRequest {
  model?: string | null;
  effort?: string | null;
}

interface Setter {
  setConfigOption(sessionId: string, configId: string, value: string): Promise<ConfigOption[] | undefined>;
}

/**
 * 应用任务的模型与思考程度。不合法的取值不让任务失败：忽略并在返回的说明里写明，智能体用它的默认值。
 * initial 为 session/new 返回的选项；resume 时没有，可传 undefined（按约定的选项 ID 尝试）。
 */
export async function applyModelConfig(conn: Setter, sessionId: string, initial: ConfigOption[] | undefined, req: ModelRequest): Promise<string[]> {
  const notes: string[] = [];
  let options = initial;
  if (req.model) {
    const opt = byCategory(options, "model");
    if (opt && !flattenChoices(opt.options).some((c) => c.value === req.model)) {
      notes.push(`模型 ${req.model} 不在该智能体的可选列表里，使用默认模型`);
    } else {
      try {
        options = (await conn.setConfigOption(sessionId, opt?.id ?? "model", req.model)) ?? options;
        notes.push(`模型：${req.model}`);
      } catch (e) {
        notes.push(`设置模型 ${req.model} 失败，使用默认模型：${(e as Error).message.slice(0, 80)}`);
      }
    }
  }
  if (req.effort) {
    const opt = byCategory(options, "thought_level");
    if (opt && !flattenChoices(opt.options).some((c) => c.value === req.effort)) {
      notes.push(`思考程度 ${req.effort} 对当前模型不可用（可选：${flattenChoices(opt.options).map((c) => c.value).join("、")}），使用默认`);
    } else {
      try {
        await conn.setConfigOption(sessionId, opt?.id ?? "reasoning_effort", req.effort);
        notes.push(`思考程度：${req.effort}`);
      } catch (e) {
        notes.push(`设置思考程度 ${req.effort} 失败，使用默认：${(e as Error).message.slice(0, 80)}`);
      }
    }
  }
  return notes;
}

/** 探测一个智能体可选的模型与思考程度：开一个临时会话读取选项，不调用模型，随即关闭 */
export async function probeAgentOptions(spec: AgentSpec): Promise<AgentOptions | null> {
  const dir = mkdtempSync(join(tmpdir(), "loopd-probe-"));
  let conn: AgentConn | null = null;
  try {
    conn = await AgentConn.open(spec, { cwd: dir, onUpdate: () => {}, onPermission: async () => "cancelled" });
    const { configOptions } = await conn.newSession(dir);
    const out = extractChoices(configOptions as ConfigOption[] | undefined);
    return out.models.length || out.efforts.length ? out : null;
  } catch {
    return null;
  } finally {
    await conn?.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}
