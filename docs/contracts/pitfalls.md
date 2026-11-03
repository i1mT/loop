# 避坑清单（阶段 01）

每条：**现象 → 成因 → 对策 → 来源**。来源分三类：
- `[MC]` Multica 开源代码（浅克隆于会话 scratchpad，`server/pkg/agent`、`server/internal/daemon`），括号内是测试或源文件名，它们的注释记录了真实事故。
- `[VK]` Vibe Kanban 开源代码（浅克隆于会话 scratchpad，`crates/executors`），已停更，只作参考。
- `[实测]` 本计划阶段 01 的 ACP 实测，见 `acp-findings.md`。

## 进程与管道

**P-1 stdin/stdout 的死锁**
- 现象：任务卡在超时（Multica 线上证据：2 小时超时，报错 `write |1: The pipe has been ended`）。
- 成因：先把 prompt 写进 stdin，再开 stdout 读取；智能体启动时先往 stdout 写大量内容，它阻塞写，守护进程阻塞写 stdin，双方都不前进。
- 对策：先开读流再写；ACP 的 `ndJsonStream` 已经并发读写，我们不要在它之前手写读取。
- 来源：`[MC]` `claude_deadlock_test.go`（`TestClaudeExecuteDoesNotDeadlockOnStartupStdoutBurst`）。

**P-2 取消必须杀整个进程组**
- 现象：取消后仍有进程存活，线上记录到一个孙进程存活 64 分钟（#5918）。
- 成因：智能体会派生 MCP 服务器或工具子进程，只杀直接子进程留下孙进程。
- 对策：启动时用独立进程组（`detached: true`），取消时对负的 pid 发信号（`process.kill(-pid, sig)`）。
- 来源：`[MC]` `claude_cancel_unix_test.go`（`TestClaudeCancellationTerminatesProcessGroupGraceful`）。

**P-3 TERM 无效时要升级到 KILL**
- 现象：某个后代进程忽略 SIGTERM，取消永远不结束。
- 对策：SIGTERM → 等待超时 → SIGKILL，并且 KILL 的目标是整个进程组。
- 来源：`[MC]` `claude_cancel_unix_test.go`（`TestClaudeCancellationEscalatesWhenDescendantIgnoresTERM`）。

**P-4 单行 JSON 可能很大**
- 现象：codex 的 `thread/resume` 把整个会话放在一行里，超过旧的 10 MiB 上限，整个读取失败。
- 对策：行缓冲上限要有余量；超限的行跳过并记录，而不是让整个流失败；尾部未结束的行要保留。
- 来源：`[MC]` `stream_scanner.go`、`stream_scanner_test.go`（`TestAgentStreamScannerReadsPastOldTenMiBCap`、`TestReadAgentStreamLineSkipsOversizedAndContinues`）。

**P-5 stdout 收集有上限，溢出要报告**
- 现象：超长输出被静默截断，结果看起来完整但其实不是。
- 对策：溢出时显式报告为错误或标记，不静默截断。
- 来源：`[MC]` `run_collect_test.go`（`TestCollectedStdoutOverflowIsReportedNotTruncated`）。

**P-6 stderr 必须有人读或忽略**
- 现象：stderr 管道写满后子进程阻塞。
- 对策：守护进程要么持续读取（保留尾部用于诊断），要么显式 `ignore`。
- 来源：`[MC]` `stderr_tail.go`（只保留尾部）；`[实测]` 探针中 stderr 用 `ignore`，未出现阻塞。

**P-7 子进程的代理环境**
- 现象：grok 经本机代理时，日志里反复出现 `Transport channel closed, HTTP 502 Bad Gateway`，输出里还有 "Got response to unknown request" 的噪声。
- 对策：启动子进程时可按智能体去掉代理变量（`PROBE_NO_PROXY=1` 的对照实验证实去掉后噪声消失）。
- 来源：`[实测]`。

**P-8 不要依赖 `pnpm exec` 找二进制**
- 现象：在测试仓库目录里运行 `pnpm exec claude-agent-acp`，子进程立刻退出，表现为 "ACP connection closed"。
- 成因：pnpm 在没有 `package.json` 的目录里找不到工作区。
- 对策：用包内 `node_modules/.bin` 的绝对路径启动；全局命令（opencode、grok）用 PATH 查找并在启动前检查存在。
- 来源：`[实测]`。

## 恢复与错误

**P-9 上下文耗尽要分类，不要当普通失败**
- 现象：Claude 上下文用尽时，最终 `terminal_reason` 看起来像成功，或者只留下不可解析的散文。
- 对策：识别特定的终止原因并映射为 `context_overflow`（可恢复：压缩后重试或拆分任务），不依赖散文。
- 来源：`[MC]` `claude_context_exhausted_test.go`（`TestClaudeTerminalReasonFailure`、`TestClaudeExecuteClassifiesContextExhaustionWithoutUsableProse`）。

**P-10 异步工具结果要大声失败**
- 现象：工具以后台方式启动，结果在 turn 结束后才到，若静默处理会丢结果。
- 对策：遇到这种情况显式失败并记录，不假装成功。
- 来源：`[MC]` `claude_deadlock_test.go`（`TestClaudeExecuteFailsLoudlyOnAsyncLaunchedToolResult`）。

**P-11 限流与重复审批要熔断**
- 现象：同一个审批反复失败，智能体不断重试，刷屏并烧 token。
- 对策：统计同一父审查的失败次数，超过阈值就中断并交给人。同一次失败不重复计数。
- 来源：`[MC]` `codex_guardian_rate_limit_test.go`（`TestCodexGuardianRateLimitCircuitInterruptsRepeatedApprovalFailures`、`TestCodexGuardianRateLimitCircuitCountsDistinctParentReviews`）。这正是旧线上"互相推诿"问题的同类：要有上限。

**P-12 崩溃后的会话要能重新加载**
- 现象：智能体进程被杀后，在途 prompt 直接以 `ACP connection closed` 拒绝。
- 对策：映射为 `crashed`（可恢复），新进程用 `session/load` 恢复，并过滤重放的历史更新。
- 来源：`[实测]`（四个智能体均通过"杀进程 → 加载 → 继续"）。

## 配置与权限（自有实测，最需要注意）

**P-13 用户全局设置会绕过 ACP 权限询问**
- 现象：claude 在 `acceptEdits` + `allow: [Edit, Write, Bash]` 下编辑文件，**0 次**权限请求，即使会话模式切到 `default`。
- 成因：全局设置的 allow 规则优先于会话模式。
- 对策：守护进程若需要严格审批，必须隔离配置运行。已尝试 `CLAUDE_CONFIG_DIR` 隔离，但它会改变钥匙串凭证的查找，结果是 `Authentication required`。**待定方案**（阶段 02 决定）：用项目级 `.claude/settings.json` 显式 `ask`，或以 hook 实现审批。
- 来源：`[实测]`。

**P-14 codex 只读下会自我拒绝**
- 现象：`read-only` 模式下让它编辑，它直接回答 blocked，没有权限请求。
- 对策：拒绝路径不能靠 ACP 权限请求测；守护进程要把"无权限请求 + 回复含 blocked"视为需要人介入。
- 来源：`[实测]`。

**P-15 opencode 的权限由它的配置文件决定**
- 现象：opencode 没有 `default` 模式（`mode not found: default`），默认放行 webfetch。
- 对策：在任务的 worktree 里写入 `opencode.json` 的 `permission` 配置（`edit/bash/webfetch` 设为 `ask`）。注意这会改动 worktree，需要在 git 的忽略规则里排除，或放在守护进程的隔离目录。
- 来源：`[实测]`。

**P-16 没有统一的 diff 事件**
- 现象：claude、opencode、grok 的编辑带 diff 内容；codex 的编辑只是 shell 命令，没有 diff。
- 对策：diff 一律由守护进程用 git（`git diff` / `git status`）在 worktree 里计算，不依赖智能体上报。
- 来源：`[实测]`。

**P-17 不要相信智能体的"已提交"声明**
- 现象：claude 在测试仓库里自行执行了 `git commit`，因为全局设置允许 Bash。
- 对策：守护进程以 git 的实际状态为准（提交哈希、分支、是否干净），智能体的文字说明只作参考。
- 来源：`[实测]`。

**P-18 模式名要查表，不能硬编码**
- 现象：`default` 对 opencode 无效；codex 的名字是 `read-only`，claude 是 `default`。
- 对策：按智能体维护模式映射，启动时用返回的 `availableModes` 校验，找不到就失败并说明。
- 来源：`[实测]`。

**P-19 恢复时的重放会混入历史**
- 现象：`session/load` 后会立即重放历史 `session/update`（四者分别重放 6–11 条）。
- 对策：界面与事件日志要区分"重放"与"新事件"；重放不得再次触发通知或审批。
- 来源：`[实测]`。

**P-20 费用不是每家都有**
- 现象：codex 的 `usage_update` 没有 `cost`。
- 对策：费用字段可选；统计报表显示"未知"，不要按 0 计算。
- 来源：`[实测]`。

## 来自 Vibe Kanban 的经验

**P-21 恢复后序号要续接，不能从 0 重来**
- 现象：守护进程重启后，新事件的序号与已存事件冲突，去重把新事件当成重复丢弃。
- 对策：启动时读取该会话已存的最大 `seq`，从它之后继续；序号按会话内单调递增，不按时间。
- 来源：`[VK]` `executors/src/logs/utils/entry_index.rs`（`start_from` 从已存的最大索引开始）。

**P-22 自动审批不要选"永久允许"**
- 现象：自动放行时优先选 `allow_always`，权限被永久记住，之后的越界操作也不再询问。
- 对策：守护进程的自动放行只选 `allow_once`；永久允许只能由人在网关里显式选择。
- 来源：`[VK]` `executors/src/executors/acp/client.rs`（`request_permission` 先找 `AllowAlways`），我们选择反过来，理由见上。

**P-23 没有可选项时要取消，不要猜**
- 现象：权限请求没有选项，若硬选第一个会造成误批准。
- 对策：无选项则回复 `cancelled`，并生成 `needs_you`。
- 来源：`[VK]` `executors/src/executors/acp/client.rs`（无选项时返回 `Cancelled` 并告警）。

**P-24 会话加载失败时要有降级：用历史生成续做提示**
- 现象：`session/load` 失败（如智能体版本升级后不兼容），任务直接死掉。
- 对策：降级为新会话，把旧会话历史摘要成一段提示词交给新会话继续；降级要记录在事件里，界面可见。
- 来源：`[VK]` `executors/src/executors/acp/session.rs`（`fork_session`、`generate_resume_prompt`）。
- 注意：本次实测中 `session/load` 对四者都成功，降级路径尚未验证，阶段 02 补测试。

**P-25 原始 ACP 行要原样落盘，便于排错与重放**
- 现象：归一化之后丢了原始字段，出现问题时无法复现。
- 对策：每条原始 ACP 更新写入原始日志（JSONL），与归一化事件分开保存；去掉 `sessionId` 等冗余字段即可。
- 来源：`[VK]` `executors/src/executors/acp/session.rs`（`append_raw_line`、`normalize_session_event`）。

**P-26 opencode 的 yolo 参数不适用于 `acp`；ACP 经它的后台服务执行**
- 现象：`--auto`（别名 `--yolo`、`--dangerously-skip-permissions`）只挂在 `opencode` 主命令和 `opencode run` 上，`opencode acp` 只认 `--login`；ACP 走 `opencode serve --service` 后台服务，传给 acp 进程的 `OPENCODE_CONFIG` 等配置未必生效。
- 对策：`AgentSpec.autoApprove`，守护进程对每个权限请求选 `allow_once`。
- 状态：已用免费模型 `opencode/deepseek-v4.1-flash-free` 实测：读 `.env` 会发权限请求，选 `allow_once` 后放行；编辑默认不请求。`opencode-go/*` 需要订阅，免费模型在 `opencode/*` 下。

**P-27 pi-acp 会吞掉模型错误**
- 现象：pi 的模型凭证无效时，`session/prompt` 约 100ms 就返回 `end_turn`，没有任何消息或工具事件（直接 `pi -p` 才看得到 401）。
- 对策：守护进程把“`end_turn` 且本轮没有消息/思考/工具输出”判为失败并写明常见原因（`runTurn`）。
- 另外：pi-acp 在首轮会输出一段 pi 版本/上下文的横幅作为 `agent_message_chunk`；pi 会读取用户自己的 MCP 配置，MCP 失败时也会以消息形式提示。

**P-28 dsh 没有 `session/load`，且模型选项是分组结构**
- 现象：`initialize` 只声明 `sessionCapabilities.resume`（不重放历史）；`model` 选项的 `options` 是 `[{group, name, options:[{value,name}]}]`，值是 JSON 字符串。
- 对策：`AgentConn.restoreSession` 按能力选 load/resume；`flattenChoices` 展平分组，值原样保留。
- 凭证：没有 `DEEPSEEK_API_KEY`（环境变量或 dsh 设置）时 `session/new` 成功，但 prompt 会返回明确的错误“no API key for provider route”。
- 版本：PATH 上桌面版自带的 `dsh` 是 0.1.x，没有 acp 配置（`--profile acp` 报找不到 profile bundle）。所以守护进程依赖包内固定的 `@deepseek-ai/dsh@0.2.1-rc.2`，不用 PATH。
- 自定义供应商：在 dsh 里配置的供应商（如 magpie）会出现在 `model` 选项里，值形如 `["magpie","evomap/evomap-deepseek-v4-flash"]`。免费模型有额度限制，报 `Free usage limit reached` 时换一个。
- 凭证文件：`~/.dsh/.credentials.yaml` 是旧版平铺格式时，0.2.x 的凭证服务无法启动（stderr 有 warning：需要加 `version: 1` 并把条目放进 `refs:`），不影响用配置里的自定义供应商。该文件是用户的凭证，不要自动修改。
