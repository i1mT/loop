// 会话事件的纯折叠逻辑（无 React 依赖，便于单元测试）

export interface Ev {
  seq: number;
  kind: string;
  at: number;
  payload: Record<string, unknown>;
}

export interface Pending {
  id: number;
  kind: string;
  body: string | null;
  optionId: string | null;
  createdAt: number;
}

export interface SessionResponse {
  ok: boolean;
  task: import("./types.ts").TaskItem;
  project: import("./types.ts").ProjectItem | null;
  stage: string;
  session: { id: string; agent: string; state: string } | null;
  events: Ev[];
  pending: Pending[];
  review: { releaseReview: boolean; planReview: boolean; headSha: string | null; approvedSha: string | null; error: string | null } | null;
  notifications: { id: number; kind: string; body: string; createdAt: number }[];
  /** 最新一页之前是否还有更早的事件 */
  hasMore?: boolean;
}

/** 把事件流折叠成展示项：同一个 toolCallId 合并，同一个 diff 路径取最新 */
export type Item =
  | { type: "message"; key: string; role: string; text: string }
  | { type: "thought"; key: string; text: string }
  | { type: "tool"; key: string; id: string; title: string; toolKind?: string; status: string }
  | { type: "diff"; key: string; path: string; change: string; patch: string }
  | { type: "needs_you"; key: string; seq: number; question: string; options: { id: string; label: string }[]; reason: string; answered: boolean }
  | { type: "status"; key: string; state: string; detail?: string }
  | { type: "usage"; key: string; used: number; costUsd?: number }
  | { type: "stop"; key: string; reason: string }
  | { type: "error"; key: string; message: string }
  | { type: "check"; key: string; name: string; ok: boolean; output: string };

export function fold(events: Ev[]): { items: Item[]; lastUsage: Item | null } {
  const items: Item[] = [];
  const toolIndex = new Map<string, number>();
  const diffIndex = new Map<string, number>();
  const answered = new Set<string>();
  // 先记录哪些 needs_you 已经被回答（权限类以 permission_resolved 为准）
  const resolvedRequests = new Set(events.filter((e) => e.kind === "permission_resolved").map((e) => String(e.payload.requestId)));
  let lastUsage: Item | null = null;
  for (const e of events) {
    const p = e.payload as Record<string, any>;
    switch (e.kind) {
      case "message": {
        const last = items[items.length - 1];
        // 同一角色的连续文本块合并成一条消息
        if (last && last.type === "message" && last.role === p.role) {
          last.text += p.text;
        } else {
          items.push({ type: "message", key: `m${e.seq}`, role: p.role, text: p.text });
        }
        break;
      }
      case "thought": {
        const last = items[items.length - 1];
        if (last && last.type === "thought") last.text += p.text;
        else items.push({ type: "thought", key: `t${e.seq}`, text: p.text });
        break;
      }
      case "tool": {
        const id = String(p.toolCallId);
        const at = toolIndex.get(id);
        if (at === undefined) {
          toolIndex.set(id, items.length);
          items.push({ type: "tool", key: `tool${id}`, id, title: p.title ?? "工具", toolKind: p.toolKind, status: p.status });
        } else {
          const it = items[at] as Extract<Item, { type: "tool" }>;
          it.status = p.status;
          if (p.title) it.title = p.title;
          if (p.toolKind) it.toolKind = p.toolKind;
        }
        break;
      }
      case "diff": {
        const path = String(p.path);
        const d: Item = { type: "diff", key: `d${path}`, path, change: p.change, patch: p.patch };
        const at = diffIndex.get(path);
        if (at === undefined) {
          diffIndex.set(path, items.length);
          items.push(d);
        } else items[at] = d;
        break;
      }
      case "needs_you": {
        const requestId = findRequestFor(events, e.seq);
        const isAnswered = requestId ? resolvedRequests.has(requestId) : false;
        if (isAnswered) answered.add(String(e.seq));
        items.push({ type: "needs_you", key: `ny${e.seq}`, seq: e.seq, question: p.question, options: p.options ?? [], reason: p.reason, answered: isAnswered });
        break;
      }
      case "status": {
        // 连续的相同状态只显示一次（启动与发送回复时都会报告 running）
        const last = items[items.length - 1];
        if (last && last.type === "status" && last.state === p.state && !p.detail) break;
        items.push({ type: "status", key: `s${e.seq}`, state: p.state, detail: p.detail });
        break;
      }
      case "usage": {
        const u: Item = { type: "usage", key: "usage", used: p.used, costUsd: p.costUsd };
        lastUsage = u;
        break;
      }
      case "stop":
        items.push({ type: "stop", key: `x${e.seq}`, reason: p.stopReason });
        break;
      case "error":
        items.push({ type: "error", key: `e${e.seq}`, message: p.message });
        break;
      case "check":
        items.push({ type: "check", key: `c${e.seq}`, name: p.name, ok: p.ok, output: p.output });
        break;
      default:
        // permission_request / permission_resolved 不单独展示：由 needs_you 卡片体现
        break;
    }
  }
  return { items, lastUsage };
}

/** needs_you 对应的权限请求 requestId：取它之前最近的一个 permission_request */
function findRequestFor(events: Ev[], seq: number): string | null {
  let rid: string | null = null;
  for (const e of events) {
    if (e.seq >= seq) break;
    if (e.kind === "permission_request") rid = String((e.payload as { requestId: string }).requestId);
  }
  return rid;
}
