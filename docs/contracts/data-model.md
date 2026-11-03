# 数据模型（新平台）

本地网关与云端网关使用同一套表结构（D1/SQLite）。迁移在阶段 03 实施，编号从 1 开始，全新库可以从头建出。

## projects
| 字段 | 说明 |
|---|---|
| id | 主键 |
| name | 名称 |
| repo_path | 本机仓库路径（仅本地网关；云端为空） |
| default_branch | 默认分支（如 main） |
| agents_md_ok | 是否找到项目 AGENTS.md 中的测试/预览/发布命令 |
| created_at | |

## sources
| 字段 | 说明 |
|---|---|
| id, project_id | |
| type | sdk / manual |
| key | 接入密钥（只存哈希） |
| allowed_origins | JSON，允许的站点 |
| enabled | |

## tasks
| 字段 | 说明 |
|---|---|
| id, project_id, source_id | |
| title, body | 反馈原文 |
| stage | 见 `task-states.md` |
| category, category_source, category_confidence | Jev 分类 |
| scale, scale_confidence | 改动规模（S/M/L） |
| **release_review** | 是否需要发布审核，**创建时定好，智能体只读** |
| **plan_review** | 是否需要方案审核，**创建时定好，智能体只读** |
| **batch_eligible** | 是否可进批次，**创建时定好，智能体只读** |
| **preview_slot** | 预览槽位，**创建时定好，智能体只读** |
| priority | low / normal / urgent |
| branch, worktree_path, base_sha, head_sha | 由守护进程写入 |
| created_at, updated_at | |

**属性前置**：上面标粗的字段只能由网关在创建任务时写入。智能体提交的补丁若包含这些键，整体拒绝（`validateAgentPatch`）。

## sessions
| 字段 | 说明 |
|---|---|
| id, task_id | |
| agent | claude / codex / opencode / grok / pi |
| external_id | 智能体自身的会话 ID（用于 `session/load`） |
| role | main（默认）/ review（只读审查，可选） |
| mode | 会话模式（按智能体映射，P-18） |
| state | starting / running / idle / needs_you / cancelled / crashed / failed / ended |
| lease_id, lease_expires_at | 当前租约（守护进程写入） |
| usage_used, usage_cost_usd | 用量（费用可空） |
| started_at, ended_at | |

## session_events
| 字段 | 说明 |
|---|---|
| session_id, seq | 主键 (session_id, seq)，幂等去重依据 |
| kind, payload | 见 `session-events.md` |
| replayed | 是否为恢复时的重放（P-19） |
| at | |

## inbox
| 字段 | 说明 |
|---|---|
| id, session_id | |
| kind | message / decision |
| body, option_id | 回复文本或所选选项 |
| created_at, delivered_at | 守护进程 ack 后写入 |

## agents_local
| 字段 | 说明 |
|---|---|
| daemon_id, kind | 联合主键 |
| bin, version | 发现结果 |
| detected_at | |

## 云端同步的范围（阶段 07）

云端只保存：tasks（全部）、sessions 的摘要与最近 N 条 session_events。完整事件日志留在本地。

## 反馈（feedbacks，迁移 9）
一个任务对应 1..N 条反馈。字段：`id`、`project_id`、`source`（sdk/api/manual）、`source_ref`、`title`、`body`、`release_review`、`scale`（tiny/small/medium/large，Jev 判定）、`scale_confidence`、`state`（`pooled` 等待合并 / `linked` 已归入任务 / `withdrawn` 已撤回）、`task_id`。
旧任务回填一条反馈，反馈 ID = 任务 ID。合成的任务 `source='batch'`，`source_ref.feedbackIds` 记录成员。
