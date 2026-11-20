#!/usr/bin/env bash
# 薄包装：转调 `node packages/cli/dist/bin.js setup`。退出码与 setup 相同。
# 默认全局安装。--global 与默认相同。位置参数转发为 --project（只拷斜杠命令）。
# 传递 --yes / --channel / --project。这里不拷文件、不写 mcp。
set -euo pipefail

DTC_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BIN="$DTC_REPO/packages/cli/dist/bin.js"

if [ ! -f "$BIN" ]; then
  echo "→ dtc 未构建，先构建..."
  (cd "$DTC_REPO" && npm install && npm run build)
fi

args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --global|global)
      shift
      ;;
    --yes)
      args+=("--yes")
      shift
      ;;
    --channel|--project)
      flag="$1"
      shift
      if [ $# -eq 0 ]; then
        echo "缺少 ${flag} 的参数" >&2
        exit 2
      fi
      args+=("$flag" "$1")
      shift
      ;;
    --channel=*|--project=*)
      args+=("$1")
      shift
      ;;
    --)
      shift
      while [ $# -gt 0 ]; do
        args+=("--project" "$1")
        shift
      done
      ;;
    -*)
      echo "未知参数: $1" >&2
      exit 2
      ;;
    *)
      args+=("--project" "$1")
      shift
      ;;
  esac
done

if [ "${#args[@]}" -eq 0 ]; then
  exec node "$BIN" setup
fi
exec node "$BIN" setup "${args[@]}"
