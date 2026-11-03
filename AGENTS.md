# Working on Loop

Loop 把用户反馈交给本地智能体，通过独立 worktree、PR、审核与发布形成闭环。

## 项目入口

- `README.md`：产品介绍与快速开始。
- `docs/architecture.md`：模块与执行边界。
- `docs/self-hosting.md`：配置、数据库与部署。
- `docs/development.md`：开发、验证与贡献。
- `docs/integrations.md`：API、SDK 与飞书接入。
- `.github/CONTRIBUTING.md`、`.github/SECURITY.md`：贡献与安全报告。

## 开发约定

- 主要使用 TypeScript，沟通与注释使用简体中文。保持职责清晰，新增目录尽量不超过 8 个文件。
- 复杂任务维护 Todo 并持续完成，完成代码后运行 `pnpm run typecheck`、相关测试和 `pnpm run build`；修复失败再提交。
- 只提交当前任务相关改动，提交信息说明实际变化。不要在未经请求时部署、修改外部资源或重写历史。
- gateway 是 vinext + Cloudflare Workers，数据源是 Neon Postgres；daemon 是 Node 进程，只通过 HTTP 访问 gateway。
- 智能体统一使用 `@agentclientprotocol/sdk`，沿用已有会话恢复机制。daemon/Test 中不要使用 Node strip-types 不支持的构造函数参数属性。
- 数据库迁移在 `apps/web/lib/migrations.ts`，时间戳使用 BIGINT 整数；驼峰 SQL 别名加双引号。状态与阶段能力只在既有状态模块定义。
- 输入、下拉、按钮和弹窗复用 `components/ui`。任务或项目的新功能优先使用实体自己的子路由。
- 修改 UI 后通过本地浏览器检查 900px 和 1440px，使用假数据或一次性测试数据。
- 联调智能体只使用一次性 fixture 仓库，不让测试修改用户的真实项目。
- 所有工作树和会话恢复都要保留 round、lease、revision 和幂等边界；守护进程本地收尾使用 local cancel，不能发送过期取消事件。

## 公开发布约定

- 不提交真实密钥、账号邮箱、机器名称、绝对路径、部署资源 ID、带凭证的截图或私人运维日志。
- 示例使用 example.com 与合成数据，凭证通过环境或受保护的本机文件提供。
- 发布公开副本时使用经过扫描的独立历史，不复制私人仓库的分支、标签、日志或截图。
- 新增智能体图标仅使用 LobeHub icons 的原始 SVG，并保留第三方授权声明。
