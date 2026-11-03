# 守护进程 ⇄ 网关协议

守护进程（`apps/daemon`）只通过 HTTP 与网关通信，不访问数据库。本地网关与云端网关使用同一协议（云端只是另一个地址）。

> 阶段 01 只定契约，实现在阶段 03。下列端点与语义是实现的依据。

## 认证

- 每台守护进程一个令牌（`Authorization: Bearer <token>`），在网关里生成并只显示一次。
- 令牌只存哈希，网关不存明文。
- 令牌不写进仓库或提交；守护进程从本地配置文件读取（`~/.loop/daemon.json`，权限 600）。

## 端点

### `POST /api/daemon/claim`
领取一个待执行的任务。
- 请求：`{ daemonId }`
- 响应：`{ claim: { leaseId, expiresAt, task: { id, title, body, agent, repoPath, mainRef, attributes, sessionId, reattach, job, approvedSha } } | null }`
- `job`：`work`（执行智能体）或 `publish`（已批准，执行发布命令）。已批准的任务，无论是否接管，本次都按 `publish` 处理并进入发布中。
- 语义：领取时写入租约（默认 60 秒，心跳续期）。租约过期后任务可被重新领取，**同一任务同一时刻只有一个有效租约**。

### `POST /api/daemon/leases/:leaseId/heartbeat`
续期。响应 `{ ok, expiresAt }`；租约已失效返回 `409`，守护进程必须停止该任务的写入。

### `POST /api/daemon/sessions/:sessionId/events`
批量上报事件。
- 请求：`{ leaseId, events: SessionEvent[] }`，每条带 `seq`。
- 幂等：网关按 `(sessionId, seq)` 去重；已存在的 `seq` 视为成功跳过。
- 乱序：网关接受任意顺序到达，按 `seq` 排序存储；缺口不阻断，界面等待或显示"同步中"。

### `GET /api/daemon/sessions/:sessionId/inbox?after=<id>`
取用户的新消息（回复、审批结果、`needs_you` 的选项）。
- 响应：`{ items: [{ id, kind: "message" | "decision", body, optionId? }] }`
- 守护进程处理完后调用 `ack` 标记已投递。

### `POST /api/daemon/inbox/:itemId/ack`
标记已投递。幂等。

### `POST /api/daemon/sessions/:sessionId/status`
更新会话状态：`{ leaseId, state, detail? }`，`state` 与 `status` 事件一致。
- 守护进程崩溃后启动时，对未结束的会话用 `status: crashed` 上报（可恢复）。

### `POST /api/daemon/sessions/:sessionId/head`
报告当前提交（审核的对象）：`{ daemonId, leaseId, head }`。只在任务为运行中、待审核、需要你时接受；发布或已批准之后忽略（头提交不能被改写）。
待审核且任务不需要发布审核（`releaseReview=false`）时，报告后直接自动批准。

### `POST /api/daemon/leases/:leaseId/complete`
发布任务的结果：`{ daemonId, outcome: "published" | "failed" | "review_needed", output }`。
- `published`：任务结束，租约释放
- `failed`：任务结束，租约释放，记录输出尾部
- `review_needed`：发布前发现提交已变（主分支同步后），回到待审核；**租约保留**（工作区仍属于本守护进程）

### `POST /api/daemon/leases/:leaseId/fail`
领取后无法启动：`{ daemonId, reason }`。释放租约，任务进入失败，记录原因。

### `POST /api/daemon/agents`
上报本机发现的智能体（阶段 06）：`{ agents: [{ kind, bin, version, detectedAt }] }`。

## 失败语义

| 情况 | 守护进程行为 |
|---|---|
| 网关 5xx / 网络错误 | 指数退避重试，事件本地缓存，不丢 |
| 租约 409 | 停止该任务写入，保留本地日志，重新 claim |
| 事件 seq 重复 | 视为成功 |
| 鉴权失败 401 | 停止全部活动，报警，不重试 |

## 版本

路径带版本前缀演进时用 `/api/daemon/v1/...`；阶段 03 开始实施时统一加前缀。


## 产品化 v1 增补（2026-10-22）

- `POST /api/daemon/hello`：机器注册与智能体上报（机器 ID = daemonId）。
- `POST /api/daemon/claim`：请求体 `{daemonId, holding: [taskId]}`，`holding` 是本机已在管理的任务，网关不再把它们当作“重新接管”返回；返回 `repoPath、githubRepo、mainRef、branch、prNumber、prUrl、approvedSha`。同机器已持有有效租约时，发布领取沿用该租约。
- `POST /api/daemon/sessions/:id/head`：附带 `branch、prNumber、prUrl`。
- `POST /api/daemon/leases/:id/heartbeat`：响应带 `stage`；为 `rejected/cancelled` 时守护进程关闭 PR、清理工作树后调用 `POST /api/daemon/leases/:id/release` 释放租约；为 `failed/published` 时只停止管理并释放租约。
- 会话事件写入是批量且幂等的：只有真正新写入的事件才会触发阶段转换；`approved/publishing` 阶段不被会话事件改动。
- 人工接口：`POST /api/tasks/:id/cancel`；`GET /api/status`。

## 智能体设置（2026-10-22）

- `hello` 的每个智能体可带 `models`、`efforts`（`[{value,name}]`，来自 ACP `session/new` 的 configOptions：category 为 `model` 与 `thought_level`）；没带时网关保留上次的值。
- `claim` 返回 `model`、`effort`（任务创建时固定）与 `instructions`（项目全局指令，领取时的最新值）。
- 守护进程启动会话后先设模型，再用返回的新选项设思考程度（`session/set_config_option`）；不合法的取值不让任务失败，忽略并在会话状态事件的 detail 里写明。恢复会话时静默重新应用。

## 模型列表按需刷新（2026-10-22）

- 不再定时探测。守护进程启动后探测一次；用户在机器页点“刷新模型列表”时，网关记下请求（`machine_agents.probe_requested_at`），随下一次 `claim` 响应的 `probe: [agent]` 带给守护进程，守护进程探测后用 `hello` 上报（成功带 `models/efforts`，失败带 `probeError`），网关据此结清请求并记录 `models_at`。
- 模型与思考程度的配置在 `machine_agents.default_model/default_effort`（`PATCH /api/machines/:id/agents/:kind`）；项目没有模型字段，任务创建时记录当时的配置。
