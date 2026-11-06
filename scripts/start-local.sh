#!/bin/bash
# 启动本机：本地 web（localhost）+ 本机守护进程。数据全部来自云端（同一个数据库）。
# 配置：~/.config/loop/loop.env（云端地址与令牌）。LOOP_LOCAL_TOKEN 是本机 cookie 的签名密钥，首次启动自动生成。
# 登录：用云端账号的邮箱和密码（本地网关把凭据交给云端验证）。
# 用法：scripts/start-local.sh            默认端口 5191
#       LOOP_LOCAL_PORT=5300 LOOPD_MACHINE_ID=home-mac scripts/start-local.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENV_FILE="${LOOP_CONFIG_PATH:-$HOME/.config/loop/loop.env}"
STATE="$HOME/.local/state/loop"
PORT="${LOOP_LOCAL_PORT:-5191}"
mkdir -p "$STATE"

if [ ! -f "$ENV_FILE" ]; then echo "缺少 $ENV_FILE（需要 LOOP_GATEWAY、LOOP_ADMIN_TOKEN）" >&2; exit 1; fi
set -a; . "$ENV_FILE"; set +a
if [ -z "${LOOP_LOCAL_TOKEN:-}" ]; then
  LOOP_LOCAL_TOKEN="$(node -e 'console.log(require("crypto").randomBytes(18).toString("base64url"))')"
  printf "\nLOOP_LOCAL_TOKEN='%s'\n" "$LOOP_LOCAL_TOKEN" >> "$ENV_FILE"
  echo "已生成本机签名密钥并写入 $ENV_FILE"
fi
DATA_DIR="${LOOPD_HOME:-$HOME/.loop-daemon}"
CONNECTION="$DATA_DIR/connection.json"
# 已接入机器必须继续使用保存的 ID；不能因为检出目录或环境变化登记另一台机器。
if [ -f "$CONNECTION" ]; then
  MACHINE_ID="$(node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).machineId)' "$CONNECTION")"
else
# 机器 ID 的规整规则与守护进程（apps/daemon/src/serve.ts 的 machineIdFrom）一致
MACHINE_ID="$(RAW="${LOOPD_MACHINE_ID:-$(hostname)}" node -e 'console.log(process.env.RAW.toLowerCase().replace(/[^a-z0-9._-]+/g,"-").replace(/^[^a-z0-9]+/,"").slice(0,64)||"machine")')"
fi

if [ -f "$STATE/web.pid" ] && kill -0 "$(cat "$STATE/web.pid")" 2>/dev/null; then echo "本地 web 已在运行（pid $(cat "$STATE/web.pid")）。先运行 scripts/stop-local.sh" >&2; exit 1; fi

# 本地模式配置：云端地址与令牌只写进服务端的 .dev.vars.localweb（不入库、权限 600），浏览器拿不到
umask 077
LOOP_LOCAL_JSON="$(GW="$LOOP_GATEWAY" TOK="$LOOP_ADMIN_TOKEN" MID="$MACHINE_ID" node -e 'console.log(JSON.stringify({upstream:process.env.GW,upstreamToken:process.env.TOK,machineId:process.env.MID}))')"
cat > "$ROOT/apps/web/.dev.vars.localweb" <<VARS
LOOP_ADMIN_TOKEN=$LOOP_LOCAL_TOKEN
LOOP_DAEMON_TOKEN=unused-in-local-mode
DATABASE_URL=unused-in-local-mode
BETTER_AUTH_SECRET=unused-in-local-mode
LOOP_LOCAL=$LOOP_LOCAL_JSON
TYPESAFE_API_KEY=
FEISHU_ENCRYPTION_KEY=
VARS
umask 022

cd "$ROOT/apps/web"
rm -f .vinext/dev/lock.json
nohup ./node_modules/.bin/vite dev --port "$PORT" --strictPort --mode localweb > "$STATE/web.log" 2>&1 &
echo $! > "$STATE/web.pid"

# 已有同目录的 daemon 时复用它；停止本地网页不会停止原有后台进程。
DAEMON_PID_FILE="$DATA_DIR/serve.pid"
if [ -f "$DAEMON_PID_FILE" ] && kill -0 "$(cat "$DAEMON_PID_FILE")" 2>/dev/null; then
  echo "沿用已有守护进程（pid $(cat "$DAEMON_PID_FILE")）"
else
  LOOP_CONFIG_PATH="$ENV_FILE" nohup "$ROOT/scripts/start-daemon.sh" > "$STATE/daemon.log" 2>&1 &
  echo $! > "$STATE/daemon.pid"
fi

for _ in $(seq 1 40); do
  curl -s --noproxy "*" -o /dev/null "http://localhost:$PORT/login" && break
  sleep 0.5
done
echo "本地 web：http://localhost:$PORT   机器 ID：$MACHINE_ID"
echo "登录：用云端账号的邮箱和密码"
echo "日志：${STATE}/web.log  ${STATE}/daemon.log    停止：scripts/stop-local.sh"
