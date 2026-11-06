#!/bin/sh
# 只安装已发布的便携包，包含 Node 与 ACP 依赖，不需要源码或包管理器。
set -eu
umask 077
gateway=''
code=''
while [ "$#" -gt 0 ]; do
  case "$1" in
    --gateway) gateway="$2"; shift 2 ;;
    --code) code="$2"; shift 2 ;;
    *) printf '未知参数：%s\n' "$1" >&2; exit 1 ;;
  esac
done
case "$gateway" in https://*) ;; *) printf '请使用网站生成的 HTTPS 安装命令。\n' >&2; exit 1 ;; esac
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) printf '目前支持 macOS 与 Linux。Windows 请使用 WSL2 安装。\n' >&2; exit 1 ;; esac
case "$(uname -m)" in arm64|aarch64) cpu=arm64 ;; x86_64|amd64) cpu=x64 ;; *) printf '暂不支持这台电脑的处理器。\n' >&2; exit 1 ;; esac
command -v curl >/dev/null || { printf '请先安装 curl。\n' >&2; exit 1; }
command -v tar >/dev/null || { printf '请先安装 tar。\n' >&2; exit 1; }
root="${HOME}/.local/share/loop"
mkdir -p "$root/versions" "${HOME}/.local/bin"
tmp="$(mktemp -d "$root/.install.XXXXXX")"
trap 'rm -rf "$tmp"' EXIT HUP INT TERM
curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --proto '=https' --proto-redir '=https' "$gateway/api/daemon-releases/latest?target=$os-$cpu" > "$tmp/release"
read -r version file sha < "$tmp/release"
# 下载清单只允许文件名，不能让其成为本机路径或 shell 指令。
case "$version" in ''|*[!a-zA-Z0-9.-]*) printf '版本信息无效。\n' >&2; exit 1 ;; esac
[ "$file" = "loopd-$version-$os-$cpu.tar.gz" ] || { printf '安装包信息无效。\n' >&2; exit 1; }
[ "${#sha}" -eq 64 ] || exit 1
case "$sha" in *[!a-f0-9]*) exit 1 ;; esac
if [ -x "$root/versions/$version/bin/loopd" ]; then
  printf '这个版本已经安装，无需重新下载。\n'
else
  printf '正在下载 Loop，首次安装需要几分钟……\n'
  curl --fail --silent --show-error --location --retry 3 --connect-timeout 15 --proto '=https' --proto-redir '=https' "$gateway/api/daemon-releases/$file" -o "$tmp/package.tar.gz"
  if command -v sha256sum >/dev/null; then actual="$(sha256sum "$tmp/package.tar.gz")"; else actual="$(shasum -a 256 "$tmp/package.tar.gz")"; fi
  actual="${actual%% *}"
  [ "$actual" = "$sha" ] || { printf '安装包校验失败，请重新下载安装。\n' >&2; exit 1; }
  mkdir "$tmp/package"
  tar -xzf "$tmp/package.tar.gz" -C "$tmp/package"
  "$tmp/package/bin/loopd" --version
  mv "$tmp/package" "$root/versions/$version"
fi
# 写入小型启动脚本，版本切换只替换一个文件，失败保留原版本。
printf '#!/bin/sh\nexec "%s/versions/%s/bin/loopd" "$@"\n' "$root" "$version" > "$tmp/loopd"
chmod 700 "$tmp/loopd"
mv "$tmp/loopd" "${HOME}/.local/bin/loopd"
printf '安装完成。命令位置：%s/.local/bin/loopd\n' "$HOME"
if [ -n "$code" ]; then
  "${HOME}/.local/bin/loopd" connect --gateway "$gateway" --code "$code"
else
  printf '请在网站添加机器，复制连接命令完成接入。\n'
fi
