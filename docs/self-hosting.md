# 自托管指南

本文面向自己部署 Loop 的维护者。准备一个 GitHub 仓库、一台开发机器、Neon Postgres 数据库和 Cloudflare 账号。模型供应商由各智能体 CLI 独立配置。

## 部署结构

- Cloudflare Worker：Web、API、飞书事件与后台恢复。
- Neon Postgres：账号、空间、项目、反馈、任务、会话与租约。
- Cloudflare R2：反馈截图和任务附件。
- 开发机器：daemon、Git、GitHub CLI、智能体和项目工具链。

网关与 daemon 不需要位于同一台机器。一个 daemon 可以处理本机绑定的多个项目，一个项目指定执行机器与智能体。

## 配置清单

| 配置 | 位置 | 用途 |
| --- | --- | --- |
| `DATABASE_URL` | Worker secret / 开发 `.dev.vars` | Neon 数据库连接 |
| `BETTER_AUTH_SECRET` | 同上 | 登录会话签名 |
| `LOOP_ADMIN_TOKEN` | 同上及受保护的本机配置 | 脚本与本机转发网关访问 API |
| `LOOP_DAEMON_TOKEN` | 同上及执行机器 | daemon 认证 |
| `FEISHU_ENCRYPTION_KEY` | Worker secret | 32 字节 base64 的飞书凭证加密主密钥 |
| `TYPESAFE_API_KEY` | 可选 Worker secret | 小问题规模判定；没有时直接创建任务 |
| `LOOP_LOCAL` | Worker secret | 云端填 `{}`；本机转发模式由脚本生成 |
| `LOOP_PUBLIC_URL` | 构建环境 → Worker text binding | 对外网关根地址，用于后台通知链接 |
| `CLOUDFLARE_ACCOUNT_ID` | 部署环境 | 自己的 Cloudflare 账号 |
| `LOOP_WORKER_NAME` | 部署环境 | Worker 名称，默认 `loop` |
| `LOOP_FILES_BUCKET` | 部署环境 | R2 bucket 名称，默认 `loop-files` |
| `LOOP_DOMAIN` | 部署环境 | 自己的自定义域名 |

密钥应分别随机生成：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

不要重复使用同一值。`FEISHU_ENCRYPTION_KEY` 丢失后将无法解密已经保存的飞书凭证，需要妥善备份。所有示例配置都没有可用的真实凭证。

## 本地开发网关

按照根目录 README 安装依赖并填写 `apps/web/.dev.vars`，迁移与创建账号：

```bash
node --env-file=apps/web/.dev.vars --experimental-strip-types scripts/migrate.mjs
node --env-file=apps/web/.dev.vars scripts/create-user.mjs admin@example.com --super
pnpm --filter @loop/web run dev --port 5190
```

首次超级管理员必须显式指定 `--super`。没有固定邮箱，也没有公开注册入口。普通账号由超级管理员在设置页面创建，再分配到空间。

账号脚本也可以重置密码，会使该账号已有登录失效。不要在 CI 日志中运行账号创建命令，它会将生成的密码输出到本机终端。

## 部署云端网关

1. 创建自己的 Neon 数据库。为开发与生产使用不同分支，测试不能连接生产数据。
2. 在 Cloudflare 创建 R2 bucket，名称与 `LOOP_FILES_BUCKET` 一致，并准备自己的域名。可以在控制台创建，或在 `apps/web` 目录使用 `./node_modules/.bin/cf r2 buckets create --name <bucket-name> --location-hint apac`。
3. 将 `config/deploy.env.example` 和 `config/secrets.env.example` 复制到仓库外的受保护位置，填写实际参数，执行 `chmod 600`。
4. 加载部署参数；它们由 `cloudflare.config.ts` 读取，不能只写入 `.dev.vars`。
5. 在目标生产数据库执行迁移并创建管理员，再构建、检查并部署。

例如，已经把文件放在 `~/.config/loop/`：

```bash
set -a
source ~/.config/loop/deploy.env
set +a

node --env-file="$HOME/.config/loop/secrets.env" --experimental-strip-types scripts/migrate.mjs
node --env-file="$HOME/.config/loop/secrets.env" scripts/create-user.mjs admin@example.com --super

pnpm run build
cd apps/web
./node_modules/.bin/cf deploy --prebuilt --dry-run --secrets-file "$HOME/.config/loop/secrets.env"
./node_modules/.bin/cf deploy --prebuilt --secrets-file "$HOME/.config/loop/secrets.env"
```

首次使用 `cf` 时按 CLI 提示完成 Cloudflare 登录。构建与部署使用 `cloudflare.config.ts`，不要另外增加 `wrangler.jsonc`。

部署后确认域名可以打开登录页，管理员可以登录，机器能够连接。飞书后台恢复依赖每分钟的 scheduled trigger，部署输出中应当出现该计划。`LOOP_PUBLIC_URL` 必须是最终可访问的 HTTPS 根地址。

## 智能体与机器

先在本机安装并认证需要使用的 CLI，再运行 daemon。项目依赖会提供 Claude/Codex ACP 适配器、Pi 适配器和 DeepSeek Harness；Grok、OpenCode、Pi 的主 CLI 需要在 PATH 上可用。

```bash
mkdir -p ~/.config/loop
cp config/daemon.env.example ~/.config/loop/loop.env
chmod 600 ~/.config/loop/loop.env
# 编辑 loop.env，配置自己的网关地址和令牌。
./scripts/start-daemon.sh
```

可以通过 `LOOP_CONFIG_PATH` 使用不同配置位置；通过 `LOOPD_MACHINE_ID` 设置固定机器 ID，通过 `LOOPD_HOME` 设置 daemon 数据目录。重启时应沿用原机器 ID 和原数据目录，否则无法恢复本机已有会话。

网页机器页会展示已发现的智能体。在具体智能体页面设置模型、思考程度；项目选择机器与智能体，任务创建时记录当时的配置。模型列表只在启动或手动刷新时探测。

智能体使用自动批准模式。执行机器应只承载你愿意授权智能体操作的项目和凭证；独立 worktree 不限制进程的系统访问能力。

## 本机转发工作台

已有线上网关时，可在开发机器启动本机 Web 工作台：

```bash
./scripts/start-local.sh
# 本机页面：http://localhost:5191
./scripts/stop-local.sh
```

本机 Web 把业务 API 转发到配置的线上网关，不另外维护数据库。脚本会启动本机 daemon，不要再手动启动第二个。需要其他端口时使用 `LOOP_LOCAL_PORT`。

## 升级、备份与恢复

- 升级前备份数据库、R2 数据、配置与 daemon 的数据目录。
- 在测试数据库运行迁移与集成测试，通过后再部署。
- 更新源码和依赖后重新构建网关，并重启每台执行机器上的 daemon。
- 任务可能等待机器上线或等待审核；无任务时轮询较慢，通常最多等待约一分钟。
- 会话恢复依赖原数据目录。任务分支、PR、租约与 round 不应手工删除或回退。
- 飞书同步失败可以在设置/技术方案页面重试；先修复资源权限，不要重复创建目录。
- 存在未完成任务时，优先通过产品中的取消、恢复、重推和重新开始操作处理。

## 健康检查

- 未登录访问业务 API 应返回 401，而不是暴露数据。
- 登录后 `/api/status` 可查询模式与当前连接。
- 机器页应显示在线，项目绑定到实际运行该 daemon 的机器。
- 用一次性测试仓库完成一轮任务、PR 审核与发布验证。
