#!/usr/bin/env bash
# dtc → Cursor 一键导入：把 commands/rules 拷进目标项目 .cursor/，合并 mcp.json（dtc MCP server）。
# 用法：bash <dtc-repo>/integrations/cursor/install.sh [目标项目目录]（默认当前目录）
set -euo pipefail

DTC_REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-$(pwd)}"
CURSOR_DIR="$TARGET/.cursor"

echo "dtc repo : $DTC_REPO"
echo "target   : $TARGET"

if [ ! -d "$DTC_REPO/packages/mcp/dist" ]; then
  echo "→ dtc 未构建，先构建..."
  (cd "$DTC_REPO" && npm install && npm run build --workspace @dtc/core && npm run build --workspace @dtc/cli && npm run build --workspace @dtc/mcp)
fi

mkdir -p "$CURSOR_DIR/commands" "$CURSOR_DIR/rules"
cp "$DTC_REPO/integrations/cursor/commands/"*.md "$CURSOR_DIR/commands/"
cp "$DTC_REPO/integrations/cursor/rules/"*.mdc "$CURSOR_DIR/rules/"
echo "✅ commands: design-to-code.md, dtc-verify.md → $CURSOR_DIR/commands/"
echo "✅ rules: f2c-workflow / anti-fabrication / stack-adaptation → $CURSOR_DIR/rules/"

# 合并 mcp.json（node 合并，避免 clobber 用户已有 servers）
node -e '
const fs = require("fs");
const path = require("path");
const repo = process.argv[1];
const target = process.argv[2];
const file = path.join(target, ".cursor", "mcp.json");
let cfg = { mcpServers: {} };
if (fs.existsSync(file)) {
  try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error("⚠️ 现有 mcp.json 解析失败，请手动合并"); process.exit(1); }
}
cfg.mcpServers = cfg.mcpServers || {};
cfg.mcpServers.dtc = { command: "node", args: [path.join(repo, "packages/mcp/dist/server.js")] };
fs.mkdirSync(path.dirname(file), { recursive: true });
fs.writeFileSync(file, JSON.stringify(cfg, null, 2) + "\n");
console.log("✅ mcp.json: dtc server → " + file);
' "$DTC_REPO" "$TARGET"

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
