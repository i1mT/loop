#!/bin/bash
# 启动本机守护进程并连接云端网关（https://loop.example.com）。
# 令牌从 ~/.config/loop/loop.env 读取（不在仓库里）。
# 用法：scripts/start-daemon.sh            连接云端
#       LOOPD_GATEWAY=http://localhost:5190 LOOPD_DAEMON_TOKEN=dev-daemon-local-token scripts/start-daemon.sh   连接本地网关
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${LOOP_CONFIG_PATH:-$HOME/.config/loop/loop.env}"
if [ -z "${LOOPD_GATEWAY:-}" ] && [ -f "$ENV_FILE" ]; then
  set -a; . "$ENV_FILE"; set +a
fi
# 配置可以指定数据目录，必须在加载配置之后查找原机器连接。
CONNECTION="${LOOPD_HOME:-$HOME/.loop-daemon}/connection.json"
if [ -z "${LOOPD_GATEWAY:-}" ] && [ ! -f "$CONNECTION" ]; then
  export LOOPD_GATEWAY="${LOOP_GATEWAY:?缺少网关地址，请先连接机器或配置 LOOP_GATEWAY}"
  export LOOPD_DAEMON_TOKEN="${LOOP_DAEMON_TOKEN:?缺少机器连接凭证}"
fi
# 守护进程只需要机器凭证与代码托管凭据，不继承网关数据库或应用主密钥。
unset DATABASE_URL BETTER_AUTH_SECRET LOOP_ADMIN_TOKEN TYPESAFE_API_KEY FEISHU_ENCRYPTION_KEY LOOP_DAEMON_TOKEN LOOP_GATEWAY
# 机器 ID：LOOPD_MACHINE_ID（默认取主机名并规整）；项目绑定到这个 ID。多台电脑各用不同的 ID。
if [ ! -f "$CONNECTION" ]; then
  export LOOPD_MACHINE_ID="${LOOPD_MACHINE_ID:-$(hostname)}"
fi
cd "$ROOT/apps/daemon"
exec node --experimental-strip-types --no-warnings src/cli.ts serve
