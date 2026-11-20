#!/bin/sh
# 只安装已发布的便携包，包含 Node 与 ACP 依赖，不需要源码或包管理器。
set -eu
umask 077
gateway=''
code=''
prepare=''
update=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    --gateway) gateway="$2"; shift 2 ;;
    --code) code="$2"; shift 2 ;;
    --prepare) prepare="$2"; shift 2 ;;
    --update) update=1; shift ;;
    *) printf '未知参数：%s\n' "$1" >&2; exit 1 ;;
  esac
done
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) printf '目前支持 macOS 与 Linux。Windows 请使用 WSL2 安装。\n' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) cpu=arm64 ;; x86_64|amd64) cpu=x64 ;; *) printf '暂不支持这台电脑的处理器。\n' >&2; exit 1 ;; esac
command -v curl >/dev/null || { printf '请先安装 curl。\n' >&2; exit 1; }
command -v tar >/dev/null || { printf '请先安装 tar。\n' >&2; exit 1; }
root="${HOME}/.local/share/loop"
mkdir -p "$root/versions" "${HOME}/.local/bin"
tmp="$(mktemp -d "$root/.install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 "$gateway/api/daemon-releases/latest?target=$os-$cpu" > "$tmp/release"
read -r version file sha < "$tmp/release"
# 下载清单只允许文件名，不能让其成为本机路径或 shell 指令。
case "$version" in ''|[!0-9]*|*[!a-zA-Z0-9.-]*) printf '版本信息无效。\n' >&2; exit 1 ;; esac
[ -z "$prepare" ] || [ "$prepare" = "$version" ] || { printf '版本清单已更新，请重试。\n' >&2; exit 1; }
[ "$file" = "loopd-$version-$os-$cpu.tar.gz" ] || { printf '安装包信息无效。\n' >&2; exit 1; }
[ "${#sha}" -eq 64 ] || exit 1
case "$sha" in *[!a-f0-9]*) exit 1 ;; esac
if [ -x "$root/versions/$version/bin/loopd" ]; then
  printf '这个版本已经安装，无需重新下载。\n'
else
  printf '正在下载 Loop，首次安装需要几分钟……\n'
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 "$gateway/api/daemon-releases/$file" -o "$tmp/package.tar.gz"
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$tmp/package.tar.gz")"; else actual="$(shasum -a 256 "$tmp/package.tar.gz")"; fi
  actual="${actual%% *}"
  [ "$actual" = "$sha" ] || { printf '安装包校验失败，请重新下载安装。\n' >&2; exit 1; }
  mkdir "$tmp/$version"
  tar -xzf "$tmp/package.tar.gz" -C "$tmp/$version"
  "$tmp/$version/bin/loopd" --version
  mv "$tmp/$version" "$root/versions" || [ -x "$root/versions/$version/bin/loopd" ]
fi
[ -z "$prepare" ] || exit 0
launcher="${HOME}/.local/bin/loopd"
if [ "$update" -eq 1 ]; then
  [ -x "$launcher" ] || { printf '找不到已安装的 loopd，请先安装。\n' >&2; exit 1; }
  cp "$launcher" "$tmp/previous"
  "$launcher" stop
  waited=0
  while :; do
    status="$("$launcher" status)"
    case "$status" in *'"running":false'*) break ;; esac
    if [ "$waited" -ge 60 ]; then
      printf '旧版守护进程仍在退出，请稍后重试。\n' >&2
      exit 1
    fi
    sleep 1
    waited=$((waited + 1))
  done
fi
# 版本切换只替换一个启动文件。
escaped="$(printf '%s' "$root/versions/$version/bin/loopd" | sed "s/'/'\\\\''/g")"
printf "#!/bin/sh\nexec '%s' \"\$@\"\n" "$escaped" > "$tmp/loopd"
chmod 700 "$tmp/loopd"
mv "$tmp/loopd" "$launcher"
if [ "$update" -eq 1 ]; then
  if ! "$launcher" start; then
    mv "$tmp/previous" "$launcher"
    "$launcher" start
    printf '新版本启动失败，已恢复上一版。\n' >&2
    exit 1
  fi
  printf '守护进程已更新到 %s。\n' "$version"
elif [ -n "$code" ]; then
  "$launcher" connect --gateway "$gateway" --code "$code"
else
  printf '安装完成。命令位置：%s\n' "$launcher"
  printf '请在网站添加机器，复制连接命令完成接入。\n'
fi
