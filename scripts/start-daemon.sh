#!/bin/bash
# 启动本机守护进程并连接云端网关（https://loop.example.com）。
# 令牌从 ~/.config/loop/loop.env 读取（不在仓库里）。
# 用法：scripts/start-daemon.sh            连接云端
#       LOOPD_GATEWAY=http://localhost:5190 LOOPD_DAEMON_TOKEN=dev-daemon-local-token scripts/start-daemon.sh   连接本地网关
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -z "${LOOPD_GATEWAY:-}" ]; then
  set -a; . "${LOOP_CONFIG_PATH:-$HOME/.config/loop/loop.env}"; set +a
  export LOOPD_GATEWAY="$LOOP_GATEWAY"
  export LOOPD_DAEMON_TOKEN="$LOOP_DAEMON_TOKEN"
fi
# 机器 ID：LOOPD_MACHINE_ID（默认取主机名并规整）；项目绑定到这个 ID。多台电脑各用不同的 ID。
export LOOPD_MACHINE_ID="${LOOPD_MACHINE_ID:-$(hostname)}"
cd "$ROOT/apps/daemon"
exec node --experimental-strip-types --no-warnings src/cli.ts serve
