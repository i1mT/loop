# 开发与验证

## 环境

使用 Node.js 24+ 和 `package.json` 声明的 pnpm 版本。安装依赖：

```bash
corepack enable
pnpm install --frozen-lockfile
```

开发网关与数据库初始化见 [自托管指南](self-hosting.md)。不要把其他部署的 `.env` 或凭证复制到提交中。

## 常用命令

| 命令 | 用途 |
| --- | --- |
| `pnpm run typecheck` | 全工作区 TypeScript 检查 |
| `pnpm run test` | 纯逻辑、daemon 与 core 测试；未配置数据库时跳过集成用例 |
| `pnpm run build` | 构建 SDK、Web（Cloudflare Workers 目标）与 daemon |
| `pnpm --filter @loop/web run build:node` | 构建 Node 自托管目标（产物在 `apps/web/node/dist`） |
| `pnpm --filter @loop/web run typecheck:sdk` | SDK 的独立 DOM 类型检查 |
| `pnpm --filter @loop/web run test:db` | 使用 Web `.env.local` 中的独立测试数据库 |

数据库测试会写入测试记录，部分用例会临时更新设置并还原。必须使用可丢弃的测试数据库，不能连接生产库。

## 代码结构与约定

- 共享状态机在 `packages/core`，页面文案与阶段能力在 `apps/web/lib/status.ts`。
- SQL 通过 `pg.ts` 的薄适配层访问 Postgres，新增结构写入迁移。
- 数据库驱动与对象存储按构建目标切换（`lib/database`、`lib/storage`，由 `package.json` 的 `imports` 条件选择）；业务代码只依赖 `pg.ts` 与 `object-store.ts` 的接口。
- 重复事件、断线重连、租约失效、旧 round 和部分成功是必须覆盖的失败路径。
- daemon 使用 Node strip-types，避免构造函数参数属性等不支持的 TypeScript 语法。
- 页面复用现有 Radix UI 组件，并提供加载、空和错误状态。
- 任务详情通过子路由分工，避免把所有功能堆进同一个组件。

## 智能体验证

使用 `scripts/make-fixture-repo.mjs` 创建一次性仓库；按脚本用法指定仓库之外的临时目录。不要让联调任务修改真实项目。

适配器通过 ACP 连接；恢复必须沿用原会话和工作树。新增模型配置时，以实际探测选项为准，不能假定所有供应商支持相同思考程度。

## UI 与截图

修改界面后至少验证 900px 与 1440px。自动化使用假 API 或测试数据库，不修改生产数据。公开截图只使用合成项目、示例账号和无效示例密钥，完整服务端密钥不能出现在图片里。

## 发布前

执行类型检查、相关测试和全量构建，再查看 Git diff。密钥扫描应覆盖历史与当前文件；图片另行检查。生成的 SDK、构建输出、测试日志和私人环境文件不提交。

## 单仓库开发

本仓库是唯一源码来源。产品代码、通用文档和配置模板在这里直接维护，README、CI 和部署指南随功能更新；不需要从其他开发仓库同步。个人配置、部署秘密和运行日志保存在仓库外或被忽略的文件中。

本机专用维护约定可以保存在被忽略的 `AGENTS.local.md`。切换检出目录时保留原 daemon 数据目录和连接配置，不复制 node_modules 或构建产物。部署前明确加载部署参数，开发与生产的数据库配置分别保存。
