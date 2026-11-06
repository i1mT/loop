# 守护进程安装包

用户在网站「机器 → 添加机器」复制命令即可完成安装和连接。命令下载便携包，自动选择 macOS/Linux 和 ARM64/x64；包含 Node、daemon 与 ACP 适配器，不需要源码或系统 Node。Windows 当前使用 WSL2。

机器默认独享。所有者可以向当前空间授予使用权；共享成员不能管理机器配置或凭证。取消共享立即撤销当前空间成员的机器使用权及相关项目/任务访问权；已有任务和所有者配置的外部反馈接入继续处理。其他空间的授权需要分别管理。现有机器保留原来的空间共享关系并归属现有管理员。

## 本机操作

安装命令位于 `~/.local/bin/loopd`，可以将这个目录加入 PATH。

```sh
~/.local/bin/loopd status
~/.local/bin/loopd start
~/.local/bin/loopd stop
```

默认数据目录 `~/.loop-daemon`，包括 `connection.json`（权限 600）、`daemon.log` 和原有任务会话。更换目录会丢失本机任务接管信息。重连先停止旧进程，等待停止完成，再执行网站生成的重连命令；机器 ID 和数据目录必须保持不变。

后台进程随当前用户运行，需要用户已有的 Git 凭据与智能体登录信息。机器只会在电脑开机且进程运行时在线；`start` 后关闭终端不会停止，重启电脑后可以再次执行 `start`。进程异常退出后独占锁最多需要两分钟释放。不自动改动登录项、Git 凭据或智能体账户。

## 维护者打包

在干净且已经提交的工作树执行构建，再生成四个平台的安装包。`pnpm deploy --legacy --os --cpu` 安装目标平台的原生可选依赖。包内保留依赖原版授权声明与 Node LICENSE，移除测试文件、source maps 和构建机 NODE_PATH，检查依赖链接均在包内。

```sh
pnpm install --frozen-lockfile
pnpm run build
node scripts/daemon-release/build.mjs /tmp/loop-release darwin-arm64,darwin-x64,linux-arm64,linux-x64
```

版本来自 daemon 的 package.json 与当前 Git commit。Node 固定为 24.13.0，下载时校验 Node 官方 SHASUMS256。最终安装包 SHA-256 写入 manifest.json，客户端在解压前校验。

先部署含 `/api/daemon-releases/*` 的网关，再上传安装包。发布使用管理员服务端令牌；普通登录账号不能上传可执行文件。发布脚本以 8 MiB 分片、最多 4 路并发写入 R2，使用 `.upload-progress.json` 保留已成功分片。中断后重新执行同一条命令继续上传；已经完成且摘要相同的对象通过 HEAD 核验后跳过。所有对象成功后才切换清单。生产配置在维护者本机 `~/.config/loop/loop.env`，不要将配置复制到安装包。

```sh
node --env-file="$HOME/.config/loop/loop.env" scripts/daemon-release/publish.mjs /tmp/loop-release
```

安装包不会公开私有 Git 历史或配置。安装脚本不会执行仓库 clone、包管理器安装、修改系统 Node 或要求 sudo。已有版本目录保留，便于维护者回退；重新安装同一个版本可以重复连接，凭证仍然需要新的一次性连接码。

## 回退

应用部署回退与下载清单回退分别执行。将之前验证的 manifest.json 重新上传即可让后续安装回到原版本，已经安装的机器保持原样。数据库迁移只添加字段与表，不删除旧数据；回退应用前要确认独立令牌仍被旧版支持，不能回退成仅识别全局令牌的版本。凭证撤销不可逆，使用新的重连码恢复。

## 发布验证

至少验证本机架构：把包解压到含空格/中文的独立目录，使用包内 Node 和最少 PATH 执行 `loopd --version`、连接一次性 HTTP fixture、后台启动、收到 hello、停止，以及凭证文件权限。其他架构需要对应系统的验证环境；仅生成包不等于已经完成该系统的运行验证。
