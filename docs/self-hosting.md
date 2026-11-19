# 自托管指南

本文面向自己部署 Loop 的维护者。网关支持两种部署形态，数据库与对象存储各自独立配置：

| 形态 | 运行环境 | 数据库 | 对象存储 | 适用场景 |
| --- | --- | --- | --- | --- |
| Cloudflare | Workers | 任意 Postgres（Neon 推荐） | R2 绑定 | 不想维护服务器 |
| Node 自托管 | 自己的服务器 / 容器 | 任意 PostgreSQL 13+ | 任意 S3 兼容存储 | 数据留在自有基础设施 |

两种形态按同一份源码构建，业务代码不区分平台：数据库驱动与对象存储实现在构建时按目标选择（见 [运行时适配](#运行时适配)）。模型供应商由各智能体 CLI 独立配置。

## 部署结构

- 网关：Web 工作台、HTTP API、飞书事件与后台恢复。
- PostgreSQL：账号、空间、项目、反馈、任务、会话与租约。
- 对象存储：反馈截图、任务附件与 daemon 安装包。
- 开发机器：daemon、Git、GitHub CLI、智能体和项目工具链。

网关与 daemon 不需要位于同一台机器。一个 daemon 可以处理本机绑定的多个项目，一个项目可按顺序绑定多台机器，并分别设置仓库路径与智能体。

daemon 只通过 HTTP 访问网关，不连接数据库，也不读取数据库与对象存储凭证。

## Node 自托管（PostgreSQL + S3）

### 前置条件

- Node.js 24（生产建议直接用仓库自带 Dockerfile，镜像内已固定版本）。
- PostgreSQL 13 及以上版本，可连通的连接串。
- S3 兼容对象存储：AWS S3、Cloudflare R2 的 S3 端点、MinIO 均可。
- 一个已创建的桶。

### 配置

复制 [node.env.example](../config/node.env.example) 到仓库外并填写，执行 `chmod 600`。关键项：

| 配置 | 用途 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `LOOP_PUBLIC_URL` | 对外 HTTPS 根地址，用于后台通知里的链接 |
| `BETTER_AUTH_SECRET` | 会话签名密钥 |
| `LOOP_ADMIN_TOKEN` | 脚本调用管理 API 的 Bearer 令牌，不能登录页面 |
| `FEISHU_ENCRYPTION_KEY` | 飞书凭证加密主密钥；留空则不启用飞书 |
| `S3_BUCKET` / `S3_REGION` | 桶名与区域 |
| `S3_PREFIX` | 可选：桶内路径前缀，多个部署共用一个桶时用于隔离；留空放桶根 |
| `S3_ENDPOINT` | 自建或兼容端点；用 AWS S3 时留空 |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | 静态凭证；留空则走实例角色等默认凭证链 |
| `S3_FORCE_PATH_STYLE` | 自建端点通常需要 `true` |

每个密钥使用独立随机值：

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

`FEISHU_ENCRYPTION_KEY` 丢失后已保存的飞书凭证无法解密，需要单独备份。示例配置里没有任何可用的真实凭证。

### 构建与启动

```bash
pnpm install --frozen-lockfile
pnpm --filter @loop/web run build:node
node --env-file=/path/to/loop.env apps/web/server.mjs
```

`build:node` 产出 `apps/web/node/dist`；`server.mjs` 启动时先执行数据库迁移，再监听端口，并每分钟跑一次后台集成任务（等价于 Workers 的定时 trigger）。监听地址由 `HOST` 与 `PORT` 控制。

首次部署创建超级管理员（迁移会自动执行；也可以手动跑一遍确认）：

```bash
node --env-file=/path/to/loop.env --experimental-strip-types scripts/migrate.mjs
node --env-file=/path/to/loop.env --experimental-strip-types scripts/create-user.mjs admin@example.com --super
```

首次超级管理员必须显式指定 `--super`。没有固定邮箱，也没有公开注册入口；普通账号由超级管理员在设置页面创建，再分配到空间。账号脚本也可以重置密码，会使该账号已有登录失效。不要在 CI 日志里运行它，密码会输出到本机终端。

### Docker

[apps/web/Dockerfile](../apps/web/Dockerfile) 构建 Node 目标；仓库根目录的 [docker-compose.yml](../docker-compose.yml) 提供网关 + Postgres + MinIO 的单机示例。

```bash
cp config/node.env.example .env      # 填写后 chmod 600
docker compose up -d --build         # 只起网关，连 .env 里的外部数据库与对象存储
```

本机试用需要内置 Postgres 与 MinIO 时，加上 profile：

```bash
docker compose --profile builtin up -d --build
```

内置服务在 `builtin` profile 后面，默认不启动——生产用云上数据库与对象存储时，不该顺带跑起本地的 Postgres 和 MinIO。

compose 文件放在仓库根：`env_file` 与 `build.context` 都相对它所在的目录解析，因此 `.env` 就在根目录，构建上下文也正是镜像需要的仓库根。

端口只有一个开关：`.env` 里的 `PORT`。compose 把它同时用于容器内监听和宿主机映射（`${PORT}:${PORT}`），健康检查也读同一个值。默认 3000，改成 8080 就整体切到 8080，不需要再单独调映射。

compose 里的数据库口令与 MinIO 账号只用于本机演示，生产必须替换，并改用受管的数据库与对象存储。`minio-init` 会创建桶，桶已存在时命令失败但可忽略。

`.env` 里的 `DATABASE_URL`、`S3_ENDPOINT` 等必须指向真实地址，不要留空依赖默认值——默认值里的 `postgres`、`minio` 是内置服务的域名，默认不启动时解析不到。

镜像内以非 root 用户运行，`HEALTHCHECK` 请求 `/api/health`；该端点不需要登录，只回答进程能否连上数据库。

### 反向代理

网关自己不做 TLS。放在 Caddy、Nginx 或云负载均衡之后，并把 `LOOP_PUBLIC_URL` 设成最终面向用户的 HTTPS 地址。转发时需要保留原始 `Host` 与 `X-Forwarded-Proto`，否则登录回调与任务链接会指向错误地址。

### 升级

```bash
docker compose build gateway
docker compose up -d gateway
```

升级前备份数据库与桶。迁移在启动时幂等执行，但不要在未备份的生产库上直接试新版本。daemon 需要单独更新并重启，见 [智能体与机器](#智能体与机器)。

## Cloudflare 部署

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

## 运行时适配

平台差异集中在两处，业务代码不感知：

- `apps/web/lib/database/*`：Workers 用 `@neondatabase/serverless` 的 HTTP 驱动与 WebSocket 连接池；Node 用 `pg` 连接池。
- `apps/web/lib/storage/*`：Workers 用 R2 绑定；Node 用 `@aws-sdk/client-s3`。

选择发生在构建时，通过 `apps/web/package.json` 的 `imports` 条件导出：`workerd` 条件命中 Workers 实现，其余命中 Node 实现。因此 Workers 产物不会打包 `pg` 与 AWS SDK，Node 产物也不会引入 R2 绑定类型。

两个目标的构建入口不同：

| 目标 | 命令 | 产物 |
| --- | --- | --- |
| Cloudflare Workers | `pnpm --filter @loop/web run build` | `.cloudflare/output` |
| Node | `pnpm --filter @loop/web run build:node` | `apps/web/node/dist` |

Node 目标的构建根是 `apps/web/node/`，而不是 `apps/web/`：vinext 只要在项目根看到 `cloudflare.config.ts` 就要求 Cloudflare 插件，而 Node 目标不需要该插件。构建配置里的 `appDir` 指回上一层，源码不因此改动。

## 本地开发网关

按照根目录 README 安装依赖并填写 `apps/web/.dev.vars`，迁移与创建账号：

```bash
node --env-file=apps/web/.dev.vars --experimental-strip-types scripts/migrate.mjs
node --env-file=apps/web/.dev.vars scripts/create-user.mjs admin@example.com --super
pnpm --filter @loop/web run dev --port 5190
```

## 智能体与机器

先在本机安装并认证需要使用的 CLI，再运行 daemon。项目依赖会提供 Claude/Codex ACP 适配器、Pi 适配器和 DeepSeek Harness；Grok、OpenCode、Pi 的主 CLI 需要在 PATH 上可用。

在网页「机器 → 添加机器」复制安装命令。安装器提供 macOS/Linux 便携包，包含 Node 和 ACP 依赖；Windows 当前使用 WSL2。连接码十分钟内有效且只能兑换一次，连接后的独立机器令牌保存在 `LOOPD_HOME/connection.json`，权限为 600。

机器默认独享，所有者可以向指定空间成员共享使用权限。不要把管理员 API 令牌或旧的全局 daemon 令牌发给使用者。

源码维护者可以运行 `./scripts/start-daemon.sh`，已有 `connection.json` 时直接沿用；可选本机配置路径由 `LOOP_CONFIG_PATH` 指定，默认 `~/.config/loop/loop.env`。daemon 不继承数据库与应用主密钥。

后台运行使用 `loopd start/stop/status`，日志与连接配置放在同一数据目录。重启和切换源码目录必须沿用原机器 ID 与 `LOOPD_HOME`（默认 `~/.loop-daemon`），否则不能恢复原会话。同一目录只能运行一个 daemon。

便携包构建与上传见 [安装包说明](../scripts/daemon-release/README.md)。

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

- 升级前备份数据库、对象存储数据、配置与 daemon 的数据目录。
- 在测试数据库运行迁移与集成测试，通过后再部署。
- 更新源码和依赖后重新构建网关，并重启每台执行机器上的 daemon。
- 任务可能等待机器上线或等待审核；无任务时轮询较慢，通常最多等待约一分钟。
- 会话恢复依赖原数据目录。任务分支、PR、租约与 round 不应手工删除或回退。
- 飞书同步失败可以在设置/技术方案页面重试；先修复资源权限，不要重复创建目录。
- 存在未完成任务时，优先通过产品中的取消、恢复、重推和重新开始操作处理。

## 健康检查

- 未登录访问业务 API 应返回 401，而不是暴露数据。
- `/api/health` 不需要登录，返回 503 表示进程连不上数据库。
- 登录后 `/api/status` 可查询模式与当前连接。
- 机器页应显示在线，项目绑定到实际运行该 daemon 的机器。
- 用一次性测试仓库完成一轮任务、PR 审核与发布验证。
