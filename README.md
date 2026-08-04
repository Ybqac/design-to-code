# design-to-code

Antigravity IDE plugin：把 Figma 设计稿还原成前端代码的工作约束包。

融合两条信息源——TalkToFigma 取的原始节点数据（数值精确）与用户截图（结构准确），含反捏造四红线护栏与两阶段强制确认闸口。

## 解决什么问题

| 信息源 | 强项 | 硬伤 |
|---|---|---|
| TalkToFigma `read_my_design` | 原始节点数据（fills/strokes/typography/坐标），不经 Figma REST，不受 429 限流 | 设计不规范时 auto-layout 字段缺失或方向错乱 |
| 视觉模型看截图 | 布局结构、视觉分组、对齐关系判断准 | 无法给精确像素，密集小目标计数不可靠 |
| f2c `get_code_to_component`（备份） | 一键出代码 + 自动下素材 | 布局常混乱，输出诱导模型跳过 fusion |
| Framelink `get_figma_data`（备份） | 简化后的结构化数据 | 受 Figma REST 限流，Viewer/Collaborator seat 易 429 |

两条都不是单独可信的 ground truth。本 plugin 用 **fusion**（截图定结构、TalkToFigma 原始数据定 ground-truth）+ **ground-truth 锁值**（反捏造机械校验）+ **两阶段确认闸口**（4a 结构描述待用户确认、4b 确认后才生成代码）解决两个高频痛点：设计稿数值准但布局乱、模型凭空捏造占位图/硬编码文案/臆造组件。

## 包含什么

```
design-to-code-plugin/                   plugin 根
├── plugin.json                          manifest（Antigravity 官方规范）
├── skills/
│   └── design-to-code/                  完整 skill（自包含）
│       ├── SKILL.md                     主入口：fusion 流程 + 触发条件 + 资源索引
│       ├── references/                  7 份细分规则
│       │   ├── fusion-protocol.md          截图 vs MCP 冲突取舍规则
│       │   ├── anti-fabrication.md         反捏造四红线完整版（正反例）
│       │   ├── ground-truth-lock.md        如何导出 ground-truth.json + 机械校验
│       │   ├── framework-react.md          React + Tailwind / CSS Modules
│       │   ├── framework-vue.md            Vue 3 + <script setup>
│       │   ├── framework-miniapp.md        微信/支付宝小程序
│       │   ├── fallback-bitmap-only.md     纯位图无源文件时的兜底
│       │   └── console-injection.js        Figma Console 注入版插件代码（绕过菜单安装）
│       ├── scripts/
│       │   └── verify-ground-truth.js      零依赖 Node 校验脚本（数值反查 + INTEGRITY_FAIL 防伪）
│       └── templates/                   Antigravity 专属模板
│           ├── gemini-md-fragment.md       注入 ~/.gemini/GEMINI.md
│           ├── antigravity-hooks.json      Antigravity hooks 配置模板
│           ├── antigravity-hook-script.js  对应 hook 脚本模板
│           ├── antigravity-plugin-structure.md  打 plugin 的结构说明
│           └── ground-truth.schema.json    ground-truth.json 的 JSON Schema
├── rules/
│   └── design-to-code.md                workspace rule（设 Always On）
├── hooks.json                           PreToolUse 自动护栏配置（指向 scripts/dtc-hook.js）
├── scripts/
│   ├── dtc-hook.js                      护栏脚本（占位图 URL + lorem ipsum）
│   └── selfcheck.js                     自检脚本（一键验证 13 项链路）
└── README.md                            本文件
```

## 安装与前置

### 1. Antigravity plugin 安装

**方式 A：user 级（个人跨项目）**
```bash
git clone git@github.com:Ybqac/design-to-code.git ~/.gemini/config/plugins/design-to-code
```

**方式 B：workspace 级（团队共享，随 repo 分发）**
```bash
git clone git@github.com:Ybqac/design-to-code.git <your-repo>/.agents/plugins/design-to-code
```

### 2. TalkToFigma 三件套（主流程首选 MCP）

TalkToFigma 走 WebSocket + Figma 插件，不经 Figma REST API，不受 429 限流，返回原始节点数据。安装三步：

```bash
# a. 装 Bun 运行时
curl -fsSL https://bun.sh/install | bash

# b. clone repo + 启动 WebSocket server（常驻，监听 localhost:3055）
git clone https://github.com/grab/cursor-talk-to-figma-mcp.git ~/code/cursor-talk-to-figma-mcp
cd ~/code/cursor-talk-to-figma-mcp && bun install && bun socket
```

在 Figma 里装插件（Community 链接：https://www.figma.com/community/plugin/1485687494525374295/cursor-talk-to-figma-mcp-plugin ），或在桌面端 Plugins → Development → Import plugin from manifest 选 `~/code/cursor-talk-to-figma-mcp/src/cursor_mcp_plugin/manifest.json`。

在 `~/.gemini/config/mcp_config.json`（以及 `~/.gemini/antigravity-ide/mcp_config.json`）加：
```json
{
  "mcpServers": {
    "TalkToFigma": {
      "command": "/Users/<your-username>/.bun/bin/bun",
      "args": ["x", "cursor-talk-to-figma-mcp@latest"]
    }
  }
}
```

**每次用之前**：终端跑 `bun socket`（常驻）→ Figma 里选中 frame → 运行插件 join channel。

**Figma 账号无 Development 菜单时**（Starter/未升级套餐）：打开 Figma 设计文件 → 浏览器 DevTools Console（F12 → Console）→ 粘贴 `references/console-injection.js` 全文 → 回车。插件 UI 会内联注入，自动连接 `ws://localhost:3055`，功能与正式安装版一致。

### 3. 备份 MCP（可选）

Framelink（受 Figma REST 限流，作为 TalkToFigma 不可用时的备份）：
```json
"Framelink Figma MCP": {
  "command": "figma-developer-mcp",
  "args": ["--figma-api-key=<your-figd-token>", "--image-dir=~/figma-assets", "--stdio"]
}
```

f2c（已在配置里时作为快速草稿备份，**不允许作为最终代码**）：
```json
"f2c-mcp": {
  "command": "npx",
  "args": ["-y", "@f2c/mcp-plugin", "--mcpServer=<your-server>", "--accessToken=<your-token>"]
}
```

## 使用方式

### 触发 skill

```
@design-to-code 还原这个页面到 <target-dir>
[截图]
（Figma 里选中目标 frame）
```

或直接说"还原这个 Figma 设计"——SKILL.md 的 description 覆盖"figma/设计稿/截图转代码/还原页面/UI 实现"等关键词，自动触发。

### 7 步主流程

1. **取源** — 模型调 TalkToFigma `join_channel` + `read_my_design` 取原始节点树；截图由用户给或模型调 `export_node_as_image` 导出
2. **导出 ground truth** — 从原始节点树直接填 `design-ground-truth.json`（raw_styles 逐节点，含 fills/strokes/typography/坐标，不反推不伪造）
3. **视觉读图** — 看截图，只输出结构化布局描述 YAML（父子嵌套/视觉分组/对齐，不给像素）
4. **fusion 融合（两阶段）** —
   - **4a**：模型输出结构描述给用户确认（不生成代码），问"结构对吗"
   - **4b**：用户确认后，模型基于确认结构 + ground-truth.json 数值自己生成代码
5. **下载真实素材** — 调 TalkToFigma `export_node_as_image(nodeId, format="SVG")` 导出真实图标/图片
6. **校验护栏** — 跑 `verify-ground-truth.js` 列未匹配值（含 INTEGRITY_FAIL 防伪造检查）
7. **回环验证** — headless 渲染生成页 → 与截图视觉 diff → 不一致回到 4a

### 关键约束

- **反捏造四红线**：禁占位图 URL（正解是 TalkToFigma 导出真素材）· 禁凭空文案（只复制截图可见的逐字内容）· 禁新造 design-system 之外的同名组件 · 禁凭空精确数值（每值在 ground-truth.json 有出处或显式标"截图估读"）
- **f2c 不直接用**：f2c 输出布局常混乱，仅作可选参考或素材下载副作用，**严禁当作 fusion 最终代码**
- **4a 闸口强制**：模型必须先输出结构描述待用户确认，不直接生成代码

## 验证

### 一键自检（推荐）

```bash
node <plugin-path>/scripts/selfcheck.js
```

跑完 13 项检查（文件完整性 / Node / Antigravity 环境 / TalkToFigma+Framelink MCP / bun 命令 / hook / verify 三态），全绿即整条链路通。有失败项会附修复提示。

### verify-ground-truth.js（数值校验 + 防伪造）

```bash
node <plugin-path>/skills/design-to-code/scripts/verify-ground-truth.js <code-dir> <ground-truth.json>
```

扫生成代码的颜色/字号/圆角/间距，逐一反查 ground-truth.json，输出未匹配清单。并在报告头部做 INTEGRITY_FAIL 防伪造检查（raw_styles 条数、nodeId 格式、via 字段来源），伪造的 ground-truth 会被当场识破。

## 设计依据

- **TalkToFigma**（`grab/cursor-talk-to-figma-mcp`）：走 WebSocket + Figma 插件，不经 Figma REST API，不受 429 限流。暴露 40 个 MCP 工具（`read_my_design` / `get_node_info` / `get_nodes_info` / `export_node_as_image` / `get_styles` / `get_local_components` 等），返回原始节点数据（fills/strokes/typography/absoluteBoundingBox 原样）
- **Framelink**（`figma-developer-mcp` v0.13.2，备份）：暴露 `get_figma_data` 和 `download_figma_images`，受 Figma REST 429 限流（Viewer/Collaborator seat 额度低）
- **多模态大模型特性**：UI 截图理解强在整体语义、弱在密集小目标与精确像素——故精确数值交 TalkToFigma、结构交用户截图视觉融合
- **Fusion + ground-truth 回锁 + 两阶段确认闸口**是本项目的设计，社区未找到完整对标项目

## License

MIT（见 [LICENSE](LICENSE)）
