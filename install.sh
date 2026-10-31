#!/bin/bash
# macOS bootstrap: only tools supplied by macOS are used, never system Node/npm.
set -euo pipefail
export PATH=/usr/bin:/bin:/usr/sbin:/sbin
unset NODE_OPTIONS NODE_PATH
umask 077

fail() { printf '安装失败：%s\n' "$*" >&2; exit 1; }
fetch() { curl --fail --location --silent --show-error --retry 3 --connect-timeout 20 --max-time 600 --proto '=https' --proto-redir '=https' "$@"; }

main() {
  local version='' observe='' release_url arch os_version asset expected actual work
  while [ "$#" -gt 0 ]; do
    case "$1" in
      --version) [ "$#" -ge 2 ] || fail '--version 需要版本号'; version="$2"; shift 2 ;;
      --observe) observe=--observe; shift ;;
      --help|-h) printf '用法：bash install.sh [--version X.Y.Z] [--observe]\n'; return ;;
      *) fail "未知参数：$1" ;;
    esac
  done
  [ "$(uname -s)" = Darwin ] || fail '只支持 macOS'
  [ "$(id -u)" -ne 0 ] || fail '请用当前登录用户运行，不要使用 sudo'
  os_version=$(sw_vers -productVersion)
  [ "${os_version%%.*}" -ge 13 ] || fail '一键安装需要 macOS 13 或更高版本'
  arch=$(uname -m)
  # A Terminal running under Rosetta should still install native Apple Silicon binaries.
  if [ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
  case "$arch" in arm64) ;; x86_64) arch=x64 ;; *) fail "不支持的芯片架构：$arch" ;; esac
  if [ -z "$version" ]; then
    release_url=$(fetch --output /dev/null --write-out '%{url_effective}' https://github.com/tccpc/codex-ringside/releases/latest)
    version=${release_url##*/v}
  fi
  [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$ ]] || fail "无效的发行版本：$version"
  release_url="https://github.com/tccpc/codex-ringside/releases/download/v$version"
  asset="codex-ringside-v$version-darwin-$arch.tar.gz"
  work=$(mktemp -d "${TMPDIR:-/tmp}/codex-ringside.XXXXXXXX")
  # Keep the path quoted even when a user's temp directory contains spaces.
  trap 'rm -rf -- "$work"' EXIT
  printf '下载 Codex Ringside %s (%s)，含专用 Node 和预编译 helper…\n' "$version" "$arch"
  fetch "$release_url/SHA256SUMS.txt" --output "$work/SHA256SUMS.txt" || fail '无法下载校验清单，请确认该版本已发布一键安装包'
  expected=$(awk -v name="$asset" '$2 == name { print $1 }' "$work/SHA256SUMS.txt")
  [[ "$expected" =~ ^[0-9a-f]{64}$ ]] || fail '发行版缺少对应架构的校验值，请使用提供一键安装包的版本'
  fetch "$release_url/$asset" --output "$work/$asset"
  actual=$(shasum -a 256 "$work/$asset"); actual=${actual%% *}
  [ "$actual" = "$expected" ] || fail '安装包 SHA-256 校验失败，未更改现有安装'
  tar -xzf "$work/$asset" -C "$work"
  local payload="$work/codex-ringside"
  [ -x "$payload/runtime/node" ] && [ -x "$payload/bridge" ] || fail '安装包缺少可执行文件'
  [ "$("$payload/runtime/node" "$payload/bin/codex-ringside.cjs" --version)" = "$version" ] || fail '安装包版本不匹配'
  printf '将安装本地后台任务，使用仅限本机的调试端口 39222。\n'
  if [ -n "$observe" ]; then
    "$payload/runtime/node" "$payload/bin/codex-ringside.cjs" install "$observe"
  else
    "$payload/runtime/node" "$payload/bin/codex-ringside.cjs" install
  fi
  printf '查看状态："$HOME/Library/Application Support/CodexRingside/bin/codex-ringside" status\n'
  # Run cleanup before the local variables leave scope.
  rm -rf -- "$work"
  trap - EXIT
}
main "$@"
