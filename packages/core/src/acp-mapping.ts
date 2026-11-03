// ACP session/update → 统一 SessionEvent 的纯函数映射。
// 只做结构转换，不做业务判断；未知更新返回 null（由调用方记录并丢弃，不能让它阻断会话）。
// 依据：docs/contracts/acp-findings.md 中的实测事件形态。
export interface AcpUpdate {
  sessionUpdate: string;
  [k: string]: unknown;
}

export type MappedEvent =
  | { kind: "message"; payload: { role: "agent" | "user"; text: string } }
  | { kind: "thought"; payload: { text: string } }
  | {
      kind: "tool";
      payload: { toolCallId: string; title?: string; toolKind?: string; status: "pending" | "in_progress" | "completed" | "failed"; input?: unknown; output?: unknown };
    }
  | { kind: "plan"; payload: { entries: { content: string; status: "pending" | "in_progress" | "completed" }[] } }
  | { kind: "usage"; payload: { used: number; size?: number; costUsd?: number } };

const TEXT_KINDS: Record<string, "agent" | "user" | "thought"> = {
  agent_message_chunk: "agent",
  user_message_chunk: "user",
  agent_thought_chunk: "thought",
};

export function mapAcpUpdate(u: AcpUpdate): MappedEvent | null {
  const text = (u.content as { type?: string; text?: unknown } | undefined)?.text;
  const role = TEXT_KINDS[u.sessionUpdate];
  if (role && typeof text === "string") {
    if (role === "thought") return { kind: "thought", payload: { text } };
    return { kind: "message", payload: { role, text } };
  }
  if (u.sessionUpdate === "tool_call" || u.sessionUpdate === "tool_call_update") {
    const toolCallId = String(u.toolCallId ?? "");
    if (!toolCallId) return null;
    const status = mapStatus(u.status);
    // tool_call_update 通常不重复 title/kind：缺失就不写，由消费方按 toolCallId 合并，不能臆造 "tool"/"other"
    const title = u.title ?? u.name;
    return {
      kind: "tool",
      payload: {
        toolCallId,
        ...(typeof title === "string" ? { title } : {}),
        ...(typeof u.kind === "string" ? { toolKind: u.kind } : {}),
        status,
        input: u.rawInput,
        output: u.rawOutput,
      },
    };
  }
  if (u.sessionUpdate === "plan" && Array.isArray(u.entries)) {
    return {
      kind: "plan",
      payload: { entries: (u.entries as { content?: unknown; status?: unknown }[]).map((e) => ({ content: String(e.content ?? ""), status: mapPlanStatus(e.status) })) },
    };
  }
  if (u.sessionUpdate === "usage_update" && typeof u.used === "number") {
    const cost = (u.cost as { amount?: unknown } | undefined)?.amount;
    return {
      kind: "usage",
      payload: { used: u.used, size: typeof u.size === "number" ? u.size : undefined, costUsd: typeof cost === "number" ? cost : undefined },
    };
  }
  return null;
}

function mapStatus(s: unknown): "pending" | "in_progress" | "completed" | "failed" {
  if (s === "in_progress" || s === "completed" || s === "failed") return s;
  return "pending";
}

function mapPlanStatus(s: unknown): "pending" | "in_progress" | "completed" {
  return s === "in_progress" || s === "completed" ? s : "pending";
}
