#!/bin/bash
# 停止本机的本地 web 与守护进程（只停 start-local.sh 启动的那两个）。
set -uo pipefail
STATE="$HOME/.local/state/loop"
for name in web daemon; do
  f="$STATE/$name.pid"
  if [ -f "$f" ]; then
    pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" && echo "已停止 ${name}（pid ${pid}）"; else echo "${name} 已不在运行"; fi
    rm -f "$f"
  else
    echo "${name} 没有运行记录"
  fi
done
rm -f "$(dirname "$0")/../apps/web/.vinext/dev/lock.json"
