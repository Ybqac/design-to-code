# design-to-code

Antigravity IDE 插件。把 Figma 设计稿还原成前端代码——截图定布局，TalkToFigma 定数值，模型自己生成代码。

## 它解决什么

设计稿转代码时，两条信息源各有硬伤：

- **TalkToFigma 原始节点数据**：颜色/字号/尺寸精确，但布局结构常错乱
- **截图视觉**：布局结构准，但给不了精确像素

这个插件把两者融合（fusion）：**截图定结构，TalkToFigma 定数值**，再叠加反捏造护栏和两阶段确认闸口，让模型老老实实按设计稿生成代码。

## 安装

### 1. 插件本体（clone 即用）

```bash
git clone git@github.com:Ybqac/design-to-code.git ~/.gemini/config/plugins/design-to-code
```

重启 Antigravity。插件内的 SKILL.md、hooks.json、rules/ 会被自动加载，无需额外配置。

### 2. TalkToFigma（主数据源）

TalkToFigma 走 WebSocket + Figma 插件，不经 Figma REST API，不受限流。安装三步：

```bash
# 装 Bun
curl -fsSL https://bun.sh/install | bash

# clone + 启动 WebSocket server
git clone https://github.com/grab/cursor-talk-to-figma-mcp.git ~/code/cursor-talk-to-figma-mcp
cd ~/code/cursor-talk-to-figma-mcp && bun install && bun socket
```

在 `~/.gemini/config/mcp_config.json`（或 `~/.gemini/antigravity-ide/mcp_config.json`）加：
```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "/Users/<你的用户名>/.bun/bin/bun",
      "args": ["x", "cursor-talk-to-figma-mcp@latest"]
    }
  }
}
```

在 Figma 里装插件：Community 链接 https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin ，或桌面端 Plugins → Development → Import plugin from manifest 选 `~/code/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/manifest.json`。

**Figma Starter 账号无 Development 菜单时**：打开 Figma 文件 → DevTools Console（F12）→ 粘贴仓库根目录 `console-injection.js` 全文 → 回车。插件自动连 `ws://localhost:3055`，功能与正式安装版一致。

### 3. 备份 MCP（可选）

Framelink（受 Figma REST 限流，TalkToFigma 不可用时的备份）：
```json
"Framelink Figma MCP": {
  "command": "figma-developer-mcp",
  "args": ["--figma-api-key=<figd_xxx>", "--image-dir=~/figma-assets", "--stdio"]
}
```

## 使用

### 每次用之前

1. 终端跑 `bun socket`（常驻）
2. Figma 里打开设计文件
3. 运行 TalkToFigma 插件，join channel

### 触发

```
@design-to-code 还原这个页面到 <target-dir>
[截图]
```

取源支持两种方式（任选其一）：
- **选中 frame**：Figma 里选中目标节点 + 截图 → 模型调 `read_my_design`
- **传链接**：贴 Figma URL（含 `?node-id=xxx`）+ 截图 → 模型提取 nodeId 调 `get_node_info`，不需选中

### 7 步流程

1. **取源** — TalkToFigma `join_channel` + `read_my_design`（或 `get_node_info`）取原始节点树
2. **导出 ground truth** — 从节点树直接填 `design-ground-truth.json`（fills/strokes/typography/坐标，逐节点）
3. **视觉读图** — 只输出结构化布局描述（父子嵌套/对齐/分组，不给像素）
4. **fusion 融合**（两阶段）— 4a 输出结构描述待用户确认 → 4b 确认后生成代码
5. **下载真实素材** — `export_node_as_image` 导出图标/图片，不用占位图
6. **校验护栏** — `verify-ground-truth.js` 扫数值出处 + INTEGRITY_FAIL 防伪造
7. **回环验证** — headless 渲染 → 与截图 diff → 不一致回到 4a

### 关键约束

- **反捏造四红线**：禁占位图 URL · 禁凭空文案 · 禁新造 design-system 之外组件 · 禁凭空数值
- **4a 闸口强制**：模型必须先输出结构描述待你确认，不直接生成代码
- **f2c 不直接用**：f2c 输出布局常混乱，仅作可选参考

## 验证

```bash
# 一键自检（13 项：文件完整性 / Node / Antigravity 环境 / MCP / bun / hook / verify）
node ~/.gemini/config/plugins/design-to-code/scripts/selfcheck.js

# 数值校验 + 防伪造
node ~/.gemini/config/plugins/design-to-code/skills/design-to-code/scripts/verify-ground-truth.js <code-dir> <ground-truth.json>
```

## 目录结构

```
design-to-code/
├── plugin.json                       manifest
├── console-injection.js              Figma Console 注入版插件（Starter 账号绕过菜单）
├── hooks.json                        PreToolUse 自动护栏（拦占位图/lorem）
├── skills/design-to-code/            skill 本体
│   ├── SKILL.md                      主入口（7 步流程 + 资源索引）
│   ├── references/                   7 份细分规则
│   ├── scripts/verify-ground-truth.js
│   └── templates/                    Antigravity 专属配置模板
├── rules/design-to-code.md           workspace rule（设 Always On）
└── scripts/
    ├── dtc-hook.js                   护栏脚本
    └── selfcheck.js                  自检脚本
```

## License

MIT
