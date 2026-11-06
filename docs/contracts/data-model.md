# 数据模型

数据源为 Neon Postgres。可执行结构与迁移编号以 [migrations.ts](../../apps/web/lib/migrations.ts) 及其导入的 schema 为准，本文说明主要关系。

| 实体 | 表 | 关键约束 |
| --- | --- | --- |
| 登录账号 | user、account、session、verification | 管理员由显式 role 决定；邮箱没有隐含特权 |
| 空间与成员 | spaces、space_members | 项目、任务与反馈按空间隔离 |
| 机器与共享 | machines、space_machines、machine_pairings | 所有者管理机器；连接码一次性兑换，独立令牌只存哈希 |
| 智能体配置 | machine_agents | 模型与思考程度属于机器上的具体智能体 |
| 项目与执行绑定 | projects、project_machines | 有序多机器绑定，每行独立路径与可选模型覆盖 |
| 反馈与合并 | feedbacks | 先保存反馈，再直接创建任务或进入项目合并池 |
| 执行任务 | tasks | 分配时保存执行配置快照；审核固定提交 SHA；round 区分迭代 |
| 租约与会话 | leases、sessions、session_events、inbox | 心跳续租；事件按会话序号幂等；恢复保留原会话 |
| 通知与设置 | notifications、kv | 设置按空间隔离，结构版本保持编号兼容 |
| 项目接入 | sdk_sources、api_keys | SDK 公钥和项目 API 密钥具有独立用途与权限边界 |
| 飞书接入 | space_feishu_bindings、feishu_chat_routes、feishu_jobs | 凭证加密；后台副作用持久重试；来源消息去重 |
| 技术方案 | task_plan_rounds、task_plans、task_plan_records | 按任务 round 与 revision 保存，批准只对应指定版本 |

## 数据约定

- 时间戳使用 BIGINT 毫秒整数；SQL 驼峰别名使用双引号。
- tasks 与 projects 使用归档表示移除，不物理删除业务历史。
- 发布前主分支同步使用 merge；真实冲突向原会话 inbox 投递修复要求，处理之后才审核新提交。
- 机器权限变更、项目绑定与任务分配使用相同事务锁，取得锁后重新核验权限。
- 升级保持既有迁移编号；回填幂等，不能重写已配置的机器所有者、凭证或共享范围。
- 本地开发与生产使用独立数据库配置；测试不能写入生产数据库。
