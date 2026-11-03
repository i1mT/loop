# 任务阶段状态机

事实源：`packages/core/src/task-states.ts`（代码与本文不一致时以代码为准并修正本文）。测试：`packages/core/src/contracts.test.ts`。

## 阶段

| 阶段 | 含义 | 是否终态 |
|---|---|---|
| `received` | 已收到，未派发（分类、属性已在此刻由网关定好） | |
| `batched` | 小改动，等待合并批次 | |
| `held` | 被拦下（疑似恶意等），等管理员放行 | |
| `queued` | 已派发，等待会话启动 | |
| `running` | 智能体会话执行中 | |
| `needs_you` | 需要人介入（结构化请求，替代旧的 `blocked`） | |
| `plan_reviewing` | 方案审核中（要不要做） | |
| `plan_approved` | 方案已通过 | |
| `reviewing` | 已有预览，等待发布审核 | |
| `approved` | 发布审核通过，待发布 | |
| `publishing` | 发布执行中（智能体在项目主分支上发布） | |
| `publish_review` | 智能体发布结束但没有给出明确结论，等人确认结果 | |
| `published` | 已发布 | 终态 |
| `rejected` | 审核驳回 | 终态（可人工重开） |
| `failed` | 失败 | 终态（可人工重开） |
| `cancelled` | 已取消 | 终态（可人工重开） |

**没有 `blocked`。** 任何"需要人"的情况都是 `needs_you`，在网关里回复后回到 `running`。

## 转换表

| 从 | 可到 |
|---|---|
| received | batched, held, queued, cancelled, failed |
| batched | queued, cancelled |
| held | queued, cancelled |
| queued | running, failed, cancelled |
| running | needs_you, plan_reviewing, reviewing, failed, cancelled |
| needs_you | running, cancelled, failed |
| plan_reviewing | plan_approved, rejected, cancelled |
| plan_approved | running, cancelled |
| reviewing | approved, rejected, running, cancelled（驳回后可回去改） |
| approved | publishing, cancelled |
| publishing | published, publish_review, failed, reviewing（发布前发现提交已变，必须重新审核；智能体明确说成功/失败直接到 published/failed，没有明确结论才到 publish_review） |
| publish_review | published, failed |

终态没有自动出边。重开只允许从 `rejected / failed / cancelled` 回到 `received`，重新走分类与派发。`published` 不可重开。

## 硬约束（由测试保证）

1. `running` 不能直接到 `published`，必须经过 `reviewing → approved → publishing`。
2. 所有阶段都能从 `received` 到达（无孤立阶段）。
3. 终态没有自动出边。

## 需要人介入的触发

确定性规则（不依赖智能体自评）：
- `rule:main-moved`：main 前进且无法按预授权自愈（冲突不在自己改动范围内）。
- `rule:permission`：收到权限请求，策略为 ask。
- `rule:outside-scope`：改动超出任务范围（如改到不允许的目录）。
- `rule:refused`：智能体无权限请求却回复含 blocked（P-14）。
- `agent`：智能体通过 `needs_you` 事件提出问题（必须带选项）。

## 与旧线上状态的对应（迁移参考）

| 旧（Multica 推出） | 新 |
|---|---|
| `pending` / 未同步 | `received` |
| `held` | `held` |
| `unassigned` | 不再存在：属性前置，派发时必有执行者 |
| `executing` | `running` |
| `blocked` | `needs_you` |
| `plan_reviewing` / `plan_approved` | 同名 |
| `reviewing` / `approved` | 同名 |
| `published` | `published` |
| `missing` | 不再存在：不依赖外部 issue |
