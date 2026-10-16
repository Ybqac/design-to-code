#!/usr/bin/env bash
# dtc → Cursor 导入。
#
# 项目级（完整体验：/design-to-code 命令 + rules + mcp）：
#   bash <dtc-repo>/integrations/cursor/install.sh [目标项目目录]
#
# 全局（装一次，所有项目可用：MCP server 全局注册 + 全局 User Rules 指引）：
#   bash <dtc-repo>/integrations/cursor/install.sh --global
set -euo pipefail

DTC_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GLOBAL_HOME="${HOME}/.cursor"

ensure_build() {
  if [ ! -d "$DTC_REPO/packages/mcp/dist" ]; then
    echo "→ dtc 未构建，先构建..."
    (cd "$DTC_REPO" && npm install && npm run build --workspace @dtc/core && npm run build --workspace @dtc/cli && npm run build --workspace @dtc/mcp)
  fi
}

merge_mcp() {
  # $1 = mcp.json 所在目录（其下必须有 .cursor？否——直接传文件所在目录）
  node -e '
const fs = require("fs");
const path = require("path");
const repo = process.argv[1];
const file = process.argv[2];
let cfg = { mcpServers: {} };
if (fs.existsSync(file)) {
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("⚠️ 现有 " + file + " 解析失败，请手动合并"); process.exit(1); }
}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.dtc = { command: "node", args: [path.join(repo, "packages/mcp/dist/server.js")] };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log("✅ MCP: dtc server → " + file);
' "$DTC_REPO" "$1"
}

if [ "${1:-}" = "--global" ] || [ "${1:-}" = "global" ]; then
  echo "== dtc 全局安装（Cursor 所有项目可用）=="
  echo "dtc repo : $DTC_REPO"
  ensure_build
  merge_mcp "$GLOBAL_HOME/mcp.json"
  mkdir -p "$GLOBAL_HOME/rules"
  cp "$DTC_REPO/integrations/cursor/rules-global/"*.mdc "$GLOBAL_HOME/rules/"
  echo "✅ 全局规则: dtc-workflow.mdc + dtc-anti-fabrication.mdc → $GLOBAL_HOME/rules/"
  cat <<EOF

完成。重启 Cursor 后：
  - 所有项目可用 dtc_* MCP 工具 + 全局工作流规则（官方 ~/.cursor/rules 全局规则机制，零手工粘贴）
  - 任意项目对话框直接说："把我在 Figma 里选中的节点还原成代码"

提示：
  - 完整一键接入（含 relay 自动拉起、Figma 通道引导等待、chromium）：dtc setup
  - 斜杠命令（/design-to-code）与项目级 rules 是 Cursor 按项目设计的；需要完整命令体验的
    项目再跑一次项目级安装即可，两者共存不冲突。
  - 通道（Figma 插件/扩展）与项目无关，装一次全局通用。
EOF
  exit 0
fi

# ---------- 项目级安装（原逻辑） ----------
TARGET="${1:-$(pwd)}"
CURSOR_DIR="$TARGET/.cursor"

echo "dtc repo : $DTC_REPO"
echo "target   : $TARGET"

ensure_build

mkdir -p "$CURSOR_DIR/commands" "$CURSOR_DIR/rules"
cp "$DTC_REPO/integrations/cursor/commands/"*.md "$CURSOR_DIR/commands/"
cp "$DTC_REPO/integrations/cursor/rules/"*.mdc "$CURSOR_DIR/rules/"
echo "✅ commands: design-to-code.md, dtc-verify.md → $CURSOR_DIR/commands/"
echo "✅ rules: f2c-workflow / anti-fabrication / stack-adaptation → $CURSOR_DIR/rules/"

merge_mcp "$CURSOR_DIR/mcp.json"

# permissions：把 dtc/node/playwright 相关命令加白（可选，存在才合并）
if [ -f "$CURSOR_DIR/permissions.json" ] || [ "${DTC_AUTO_PERM:-0}" = "1" ]; then
  echo "ℹ️  建议在 .cursor/permissions.json 里放行: node <dtc>/packages/cli/dist/bin.js 与 npx playwright"
fi

cat <<'EOF'

完成。下一步：
1. Cursor 里 /mcp 确认 dtc server 已连（或重启 Cursor）
2. 通道安装（一次性）：bash -c "node <dtc-repo>/packages/cli/dist/bin.js plugin install"
   → 浏览器拖入 plugin/build/web/dtc-bridge.user.js（或桌面 App Import manifest）
3. relay 常驻：~/code/cursor-talk-to-figma-mcp && bun socket
4. 在任意项目里输入 /design-to-code <Figma链接> 开始
EOF
