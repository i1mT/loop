# 统一会话事件

事实源：`packages/core/src/session-events.ts`（zod schema）。ACP 到事件的映射：`packages/core/src/acp-mapping.ts`。

## 信封

每条事件都有：`seq`（会话内单调递增，用于增量拉取与去重）、`sessionId`、`at`（毫秒时间戳）、`kind`、`payload`。

## 种类

| kind | payload 要点 | 来源 |
|---|---|---|
| `status` | `state`: starting/running/idle/needs_you/cancelled/crashed/failed/ended | 守护进程 |
| `message` | `role`: agent/user，`text` | ACP `agent_message_chunk` |
| `thought` | `text` | ACP `agent_thought_chunk` |
| `tool` | `toolCallId`、`title`、`toolKind`、`status`（pending/in_progress/completed/failed） | ACP `tool_call(_update)` |
| `diff` | `path`、`change`（added/modified/deleted）、`patch` | **守护进程用 git 计算**（P-16） |
| `plan` | `entries[]`（content、status） | ACP `plan` |
| `usage` | `used`、`size?`、`costUsd?` | ACP `usage_update` |
| `permission_request` | `requestId`、`title`、`options[]`（kind 为 allow_once/allow_always/reject_once/reject_always） | ACP `session/request_permission` |
| `permission_resolved` | `requestId`、`optionId`、`decidedBy`（policy/human） | 守护进程 |
| `needs_you` | `reason`、`question`、`suggestion?`、`options[1..6]` | 守护进程规则或智能体 |
| `stop` | `stopReason`: end_turn/max_tokens/max_turn_requests/refusal/cancelled/unknown | ACP `session/prompt` 响应 |
| `error` | `message`、`fatal` | 适配器 |
| `check` | `name`: test/preview/publish，`ok`，`output` | 守护进程（只展示，**不驱动阶段**） |

## 规则

- 未知的 ACP 更新返回 `null`，丢弃并记录，**不能阻断会话**。
- 同一 `toolCallId` 的多次更新按顺序合并，最终状态以最后一次为准。
- 重放事件（`session/load` 时）要标记并且不触发通知（P-19）；契约暂不增加字段，由守护进程在写入时过滤。
- 费用可选；统计不假设存在（P-20）。
- 非法事件由 `parseSessionEvent` 拒绝并给出路径级错误，守护进程记录后丢弃。
