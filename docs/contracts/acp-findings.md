# ACP 实测结论（阶段 01）

实测日期：2026-10-21。宿主：`apps/daemon/src/harness.ts`（`withAgent`，所有操作在 `connectWith` 回调内完成）。
智能体启动：本包 `node_modules/.bin` 的绝对路径（`claude-agent-acp`、`codex-acp`），`opencode acp`、`grok agent stdio`。
原始证据：`docs/contracts/evidence/findings-<agent>.json`（每个键对应一个测试项）。

## 一、结论总表

| 项 | claude | codex | opencode | grok |
|---|---|---|---|---|
| 基础对话 `end_turn` | ✔ | ✔ | ✔ | ✔ |
| 编辑文件时的权限请求 | **0 次**（用户全局设置放行，见 P-13） | **1 次**（`read-only` 下） | **1 次**（`opencode.json` 配 `ask`） | **0 次**（编辑默认放行） |
| 联网/命令的权限请求 | 1 次（WebFetch，拒绝后 `end_turn`） | 0 次（codex 只读下自行回答 blocked，见 P-14） | 1 次（webfetch 配 ask，拒绝后 **`cancelled`**） | 1 次（拒绝后 **`cancelled`**） |
| 拒绝后的 stopReason | `end_turn`，智能体自己说 blocked | `end_turn`，智能体自己说 blocked | `cancelled`，无回复文本 | `cancelled` |
| diff 事件（`content` 含 diff） | ✔ `edit:Edit` | ✘ 只有 shell（`execute:exec_command`） | ✔ `edit:edit` | ✔ `edit:-` |
| 取消 `session/cancel` | ✔ `cancelled`，25 ms | ✔ `cancelled`，118 ms | ✔ `cancelled`，47 ms | ✔ `cancelled`，70 ms |
| 加载会话 `session/load` | ✔ ok，重放 8 条 | ✔ ok，重放 11 条 | ✔ ok，重放 7 条 | ✔ ok，重放 10 条 |
| 加载后继续上下文 | ✔ 答出 probe-edit | ✔ 答出 probe-edit | ✔ 答出 probe-edit | ✔ 答出 probe-edit |
| 杀进程后在途 prompt | 拒绝，`ACP connection closed` | 同左 | 同左 | 同左 |
| 杀进程后加载 + 继续 | ✔ 记得口令 | ✔ | ✔ | ✔ |
| 会话模式切换 `session/set_mode` | ✔ `default`（Manual） | ✔ `read-only` | ✘ 无模式，`mode not found` | ✔ |
| 用量与费用 `usage_update` | 有 `used/size/cost` | 有 `used/size`，**无费用** | 有 `cost` | 有 |

## 二、各项的测试方法与关键观察

### 1. 基础对话与事件形态
- 文本：`agent_message_chunk`（`content.text`）。思考：`agent_thought_chunk`。
- 工具：`tool_call` / `tool_call_update`，`toolCallId` 相同则为同一次调用的多次更新。claude 的 `kind` 为 `read/edit/execute`；codex 的 `kind` 只有 `execute`（所有操作都是 shell）；grok 的 `kind` 可能缺省，需从 `_meta` 取工具名。
- 用量：`usage_update`。费用字段不统一（codex 没有），统计不能假设费用存在。
- 另有 `session_info_update`、`available_commands_update`、`plan`（本轮未出现）：映射层直接丢弃未知类型。

### 2. 权限请求（`session/request_permission`）
- 测试方法：`withAgent(... { decide: "reject" })` 收到请求时选 `reject_once`。
- 这些请求**只在智能体的配置允许"询问"时才出现**，没有统一的"默认询问"。各家的开关不同：claude 用会话模式或全局设置；codex 用沙箱模式（`read-only` 才询问）；opencode 用自己的 `opencode.json`；grok 联网需询问、编辑默认放行。
- 选项 `kind` 使用 `allow_once` / `reject_once`；必须按 `kind` 选，不要按位置选。

### 3. 拒绝后的收尾
- claude/codex：`end_turn`，智能体读到拒绝后回复 blocked，会话仍可继续。
- opencode/grok：拒绝即整轮 `cancelled`。
- 守护进程状态机必须两种都处理：`end_turn` + 回复含 blocked 也要视为"需要你"，`cancelled` 是可恢复的中断。

### 4. 取消
- 全部 `cancelled`，延迟 25–118 ms（只是等待 stop 的时间）。
- 注意：这只验证了 ACP 层的收尾，**子进程是否残留需要用进程树检查**，留给阶段 02（见 `pitfalls.md` P-2、P-3）。

### 5. 恢复与崩溃
- `session/load` 对四者都返回 ok，并会**重放历史更新**（通过 `session/update` 通知），界面需要区分"重放"与"新事件"。
- 杀进程后，在途 prompt 以 `ACP connection closed` 拒绝，不会卡住。守护进程应把它映射为 `crashed`（可恢复），而不是 `failed`。
- 恢复后的继续性：四者都能在新进程里答出上一轮的口令（`crash-resume-probe.ts`）。

### 6. 会话模式
- `session/set_mode` 的模式名各家不同：claude 为 `default/acceptEdits/plan/auto/bypassPermissions`；codex 为 `read-only/workspace-write/agent/agent-full-access`；opencode 无模式；grok 有。
- 守护进程应按智能体查表，不能硬编码 `default`。

## 三、未能用 ACP 测到的

- **codex 的拒绝路径**：codex 在 `read-only` 下看到限制后直接自我拒绝，不发权限请求。需要在守护进程层用沙箱或命令审批来测（阶段 02）。
- **claude 的编辑审批**：用户全局设置 `allow: [Edit, Write, Bash]` + `defaultMode: acceptEdits` 使编辑不询问。为了不改动用户设置，这一项用 WebFetch 代替。守护进程若要严格审批，必须在隔离配置下运行，但隔离 `CLAUDE_CONFIG_DIR` 会丢失钥匙串凭证（`Authentication required`），需要另找方案（见 P-13）。
- **pi**：无 ACP，未测（阶段 06）。

## 四、对守护进程设计的直接影响

1. 事件归一化只依赖 `session/update` 的标准字段；diff 不依赖智能体，由守护进程用 git 计算（P-16）。
2. 权限策略按智能体配置（会话模式、`opencode.json`、沙箱）分别落实，不能假设统一的"默认询问"。
3. 拒绝后的状态要同时支持 `end_turn`（智能体回复 blocked）与 `cancelled`。
4. 崩溃映射为可恢复状态；恢复用 `session/load`，并过滤重放的历史更新。
5. 费用可能缺失，统计按"有则记、无则空"。

## 五、阶段 07：opencode / pi / dsh 接入实测（2026-10-26）

宿主：`AgentConn` + `BUILTIN_SPECS`（真实启动规格），一次性测试仓库。模型：opencode 用免费的 `opencode/deepseek-v4.1-flash-free`；pi 用默认的 magpie 路由；dsh 用 magpie 自定义供应商下的 `evomap/evomap-deepseek-v4-flash`（`our-free-model/deepseek-v4.1-flash-free` 当天额度用完）。

| 项 | opencode 2.0.26 | pi 1.2.0 + pi-acp 0.0.34 | dsh 0.2.1-rc.2 |
|---|---|---|---|
| 启动 | `opencode acp` | `pi-acp`（包内 bin） | 包内 `dsh --profile acp` |
| `loadSession` / `resume` | ✔ / ✔ | ✔ / ✘ | ✘ / ✔（不重放） |
| model 选项 | 140 项（`provider/model`） | 87 项 | 分组，值为 JSON 字符串（含用户在 dsh 里配置的 magpie 供应商，共 77 项） |
| thought_level | id=`effort`：none/low/medium/high/xhigh/max/default | low/high | off/low/high/max |
| 其它 | `mode`：build/plan（默认 build） | `modes` 同为思考档 | 无模式 |
| 基础对话 | ✔ | ✔ | ✔ |
| 编辑与 diff 事件 | ✔ `edit` 带 diff，git diff 一致 | ✔ `edit` 带 diff | ✔ 工具 kind 为 `other`、事件里无 diff（由 git 计算，P-16）；git diff 一致 |
| 权限请求 | 编辑 0 次；读 `.env` 会请求（实测 1 次），选 `allow_once` 后放行 | 0 次（pi 无权限系统） | 0 次（含写工作目录之外的文件；有无 `DSH_PERMISSION_MODE` 都不请求，该变量的作用没能区分） |
| 取消 | ✔ `cancelled`，43 ms | ✔ 9 ms | ✔ 13 ms |
| 关闭后残留进程 | 无 | 无 | 无 |
| 重启后恢复并继续上下文 | ✔ | ✔ | ✔（`session/resume`，答出上一轮的编辑） |
| 用量 | `usage_update` 带 `cost` | `used/size`，无费用 | `used/size`，无费用 |
| 无凭证时的表现 | prompt 报 `Authentication required` | **静默 end_turn**（P-27） | 明确报错（P-28） |

仍只用假智能体测过的：`autoApprove` 在守护进程里的放行路径（`daemon.test.ts`）。真实 opencode 已确认权限请求会出现、`allow_once` 有效。
