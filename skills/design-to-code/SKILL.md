---
name: design-to-code
description: 把 Figma 设计稿或 UI 截图还原成前端代码时使用。融合两条信息源——Figma MCP 导出的代码/样式（数值精确但常因设计不规范导致布局错乱）与视觉模型对截图的布局判断（结构正确但无精确像素），二者互补产出页码。当用户提到 Figma、设计稿、截图转代码、还原页面、figma MCP、视觉稿、UI 实现、设计还原、截图生成代码时触发，即使用户没明说"design-to-code"。解决两个高频痛点：MCP 代码样式准但布局乱、以及模型凭空捏造占位图/硬编码文案/臆造组件。
---

# Design-to-Code（Figma 草稿 + 截图视觉互补还原前端）

## 这个 skill 解决什么

把设计稿还原成前端代码时有两条信息源，各有硬伤：

| 信息源 | 强项 | 硬伤 |
|---|---|---|
| TalkToFigma 取的原始节点树（`read_my_design` / `get_node_info`） | 数值精确（颜色/字号/边框/尺寸/宽高/坐标）+ 原始未转码 | 设计不规范时 auto-layout 字段缺失或方向错乱 |
| 视觉模型看截图 | 布局结构、视觉分组、对齐关系判断准 | 无法给精确像素，密集小目标计数不可靠 |

两条都不是单独可信的 ground truth。**主思路是 fusion：截图定结构与布局，TalkToFigma 原始节点树定 ground-truth**。`design-ground-truth.json` 的**主用途是给模型生成代码时查值**——每个节点的背景/边框/字号/圆角/阴影/宽高都从这里取，不靠截图猜。**次用途是校验凭证**——生成完后 verify 脚本反查这份文件，抓"模型没查就凭空写的值"。ground-truth 只服务反捏造四红线里的第四条（禁凭空数值），不是反捏造的全部载体。

这套做法与 Figma 官方 MCP 指南的建议方向一致（指南推荐"标记完成前与 Figma 1:1 校验"）。Fusion + ground-truth 数值锁 + 两阶段确认闸口是本项目的设计，未在社区找到完整对标项目。

## 端到端主流程（7 步）

> **主流程 MCP 用 TalkToFigma**（走 WebSocket + Figma 插件，不经 Figma REST API，不受 429 限流，拿原始节点数据）。f2c 和 Framelink 作为备份——Framelink 受 Figma REST 限流，f2c 给转码代码草稿不是原始数据。详见下方"MCP 选择"。

**前置条件（每次用之前必须做）**：
1. 终端跑 `bun socket`（在 `~/code/cursor-talk-to-figma-mcp` 目录下），WebSocket server 常驻监听 localhost:3055
2. Figma 里打开设计文件（可选：选中要还原的 frame——给链接+nodeId 时不需选中）
3. 运行 cursor-talk-to-figma-mcp 插件，join 一个 channel（如 `talk-to-figma`）

1. **取源** — 用户提供截图 + Figma 里选中的节点 **或** Figma 链接（含 nodeId）。两种方式都支持：
   - 模型先调 TalkToFigma 的 `join_channel` 连接 Figma 插件——**注意参数名是 `channel`，不是 `channel_name`**：`join_channel({ channel: "talk-to-figma" })`
   - 如果 `join_channel` 返回 "Please provide a channel name" 说明参数名错了，改用 `{ channel: "..." }` 重试
   - **方式 A（选中 frame）**：调 `read_my_design` 读取当前选中节点的完整节点树数据
   - **方式 B（给链接）**：从 URL 提取 nodeId（`?node-id=14669-9900` → `14669:9900`，破折号换冒号），调 `get_node_info(nodeId)` 读单个节点、或 `get_nodes_info(nodeIds[])` 批量读多节点。不需在 Figma 里选中
   - 备选：调 `export_node_as_image(nodeId, format)` **截图能力**——可以导出任意节点为 PNG/SVG，作为"节点内截图"（不再需要用户手动截）。
   - 只有截图没 Figma 访问：跳到第 3 步，并按需读 `references/fallback-bitmap-only.md`
2. **导出 ground truth** — 把 `read_my_design` 返回的原始节点树数据**整理成** `design-ground-truth.json`。**关键：raw_styles 必须逐节点生成（不止 1 条）**，每条从节点树直接填：`nodeId`（真实 Figma 纯数字冒号格式）+ `role`（card/button/text/...）+ `fills[role=background/shadow]` + `strokes[role=border/divider]` + `width`/`height`（从 `absoluteBoundingBox` 取）+ `cornerRadius` + `textColor`/`textStyle`（TEXT 节点）。**不再需要从代码反推**——原始节点数据直接含 fills/strokes/typography/boundingBox，模型机械填入即可。nodeId 不接受 `:purple` 英文后缀。详见 `references/ground-truth-lock.md` 和 `templates/ground-truth.schema.json`。
3. **视觉读图** — 看截图（用户给的或 TalkToFigma `export_node_as_image` 导出的），**只输出结构化布局描述**（父子嵌套、视觉分组、对齐、相对间距、层级关系），**不要给精确像素**——这是 ground-truth 的事。结构化描述示例见 `references/fusion-protocol.md`。
4. **fusion 融合（两阶段，强制用户确认闸口）** —
   - **4a. 输出结构描述给用户确认**：按 `references/fusion-protocol.md` 处理冲突（结构与布局听截图、数值听 ground-truth），输出**结构化布局描述 YAML**（父子嵌套 + 语义角色 + 相对间距 + 冲突仲裁标注），**不生成代码**。明确告诉用户："这是融合后的结构，确认对了再生成代码。"
     - **重要**：如果目标目录已存在旧 HTML/代码（如之前的测试输出），**必须先告诉用户"目录有旧代码，建议清空或换新目录"**，不要在旧代码上打补丁——打补丁会绕过 fusion 结构重写，重复 f2c 残留的布局错误。等用户确认目录处理方式后再继续。
   - **4b. 用户确认后才生成代码**：用户回复"结构对了"或确认后，模型基于确认的结构 + ground-truth.json 数值，**自己写出代码**。数值优先从 ground-truth.json 取（注释 `/* from nodeId */`）；不在 ground-truth 的标"截图估读"。
   - **为什么强制两阶段**：实测证明模型会声称"已按截图 fusion 修复"但代码实际是 f2c 原样输出，或读旧代码走打补丁路径。强制 4a 输出结构描述让"假融合"被当场识破——代码可以对不上截图，但结构描述必须先过用户的眼。
5. **下载真实素材** — 调 TalkToFigma 的 `export_node_as_image(nodeId, format="SVG")` 或 `format="PNG"` 把截图里看到的图标/图片导出，存到项目约定目录（`assets/`、`public/figma-assets/`）。**不要用 picsum/placeholder**——这是反捏造红线 #1 的正解。Framelink 的 `download_figma_images` 也可用（但受 REST 限流），TalkToFigma 的 `export_node_as_image` 不受限流。
6. **校验护栏** — 跑 `scripts/verify-ground-truth.js` 列未匹配值清单（含 INTEGRITY_FAIL 防伪造检查）；对照 `references/anti-fabrication.md` 自查占位图/硬编码文案/臆造组件。
7. **回环验证** — headless 渲染生成页 → 与截图视觉 diff → 不一致回到第 4a 步。

## MCP 选择

| 场景 | 用哪个 MCP | 原因 |
|---|---|---|
| 设计稿还原（主流程） | **TalkToFigma** | 原始节点数据（fills/strokes/typography/boundingBox），不经 REST，不受限流 |
| 导出节点截图 | **TalkToFigma** `export_node_as_image` | 替代缺失的 screenshot 工具 |
| 下载素材（备份手段） | **Framelink** `download_figma_images` | 受 Figma REST 限流（429），作为 TalkToFigma 不可用时的备份 |
| 快速代码草稿（备份手段） | **f2c** `get_code_to_component`（如已配置） | 布局常混乱，仅作参考，不允许直接用为最终代码 |

## f2c 使用纪律（重要）

**默认不调 f2c**。f2c 的 `get_code_to_component` 输出布局混乱（设计不规范时它会按 Figma 原始节点树出码，不看截图、不读 ground-truth），把它当最终结果会导致布局错乱。实测证明模型还会编造"已按截图修复"的幻觉汇报。

何时可用 f2c（如已配置到 mcp_config.json）：
- 你明确想要"快速看一眼大致结构"——但 f2c 输出**仅作参考**，必须按截图重写布局
- 想用 f2c 自动下载素材的副作用（TalkToFigma 的 `export_node_as_image` 或 Framelink 的 `download_figma_images` 可替代）

**严禁**：把 f2c 生成的代码直接交付、或把 f2c 输出当成 fusion 产物。f2c 输出必须经过"读截图→重写布局→对齐 ground-truth 数值"的 fusion 重写。

## MCP 选择速查

| 想做什么 | 调什么 |
|---|---|
| 连接 Figma 插件 channel | TalkToFigma `join_channel(channel_name)` |
| 取选中节点的完整原始数据 | TalkToFigma `read_my_design` |
| 取单个节点的信息 | TalkToFigma `get_node_info(nodeId)` |
| 批量取多节点 | TalkToFigma `get_nodes_info(nodeIds[])` |
| 导出节点为 PNG/SVG 素材 | TalkToFigma `export_node_as_image(nodeId, format)` |
| 取 Figma 文档样式定义 | TalkToFigma `get_styles` |
| 取本地组件清单 | TalkToFigma `get_local_components` |
| （备份）批量下素材 | Framelink `download_figma_images(fileKey, nodes, localPath)`（受 REST 限流）|
| （备份，不直接用）快速取代码草稿 | f2c `get_code_to_component`（**不允许作为最终代码**）|

## 反捏造核心条款（详细版见 references/anti-fabrication.md）

交付前代码必须通过这四条机械检查：

- **占位图**：禁止 `placeholder.com` / `via.placeholder` / `placehold.co` / `picsum.photos` / `loremflickr` 等任何占位图服务。**正解是调 `download_figma_images` 下 Figma 真实素材**；实在下不到时用 `<div>` + 注释 `<!-- TODO: replace with asset from <nodeId> -->`，并在交付说明里列出缺失资产清单。
- **文案**：禁止任何不在截图/ground-truth 里出现的文案。不准编产品名、按钮文案、错误提示、版权年份。复制截图里出现的逐字文案。
- **组件**：只能用 design-system registry 里列出的组件。registry 没有该组件时，用语义化原生标签（`<button>`/`<div>`+className）并在交付说明里标"待替换为 design-system XXX 组件"，**不要新造一个同名组件**。
- **数值**：每个 color / font-size / border-radius / gap / z-index 值，要么在 ground-truth.json 有出处，要么显式标注"截图估读，待 Dev Mode 核实"。

## references 索引（按需读取）

主流程默认需要的两份先读，其余按场景：

- **默认必读**：
  - `references/fusion-protocol.md` — 截图 vs MCP 冲突时的取舍规则与结构化布局描述格式
  - `references/anti-fabrication.md` — 反捏造清单完整版，含正反例
- **有 Figma 链接时读**：
  - `references/ground-truth-lock.md` — 如何导出 ground-truth.json、如何用它做机械校验
- **按目标框架读其一**：
  - `references/framework-react.md` — React + Tailwind / CSS Modules
  - `references/framework-vue.md` — Vue 3 + `<script setup>`
  - `references/framework-miniapp.md` — 微信/支付宝小程序
- **纯位图无源文件时读**：
  - `references/fallback-bitmap-only.md` — 用 Surya / PP-StructureV3 兜底版面识别
- **Figma 账号无 Development 菜单时读**：
  - `references/console-injection.js` — Figma Console 注入版插件代码（Starter/未升级套餐绕过菜单安装）

## scripts/

- `scripts/verify-ground-truth.js` — 零依赖 Node 脚本。用法：`node verify-ground-truth.js <code-dir> <ground-truth.json>`，扫描 .tsx/.jsx/.vue/.wxml/.css，输出未在 ground-truth.json 找到出处的颜色/字号/间距清单。

## templates/（Antigravity 专属）

- `templates/gemini-md-fragment.md` — 注入 `~/.gemini/GEMINI.md`（与已有的 "No hardcoded values" 协同）
- `templates/antigravity-hooks.json` — 复制到 `<repo>/.agents/hooks.json`，配 PreToolUse 硬拦 + PostToolUse 反馈
- `templates/antigravity-hook-script.js` — hooks.json 调用的零依赖 Node 脚本（已冒烟测试通过）
- `templates/antigravity-plugin-structure.md` — 打成 Antigravity plugin 的目录结构与安装说明
- `templates/ground-truth.schema.json` — `design-ground-truth.json` 的 JSON Schema

## 装法速查

- **Antigravity**（首选）：plugin 整包 clone 到 `~/.gemini/config/plugins/`（user 级）或 `<repo>/.agents/plugins/`（workspace 级）；Figma MCP 由用户自行在 `~/.gemini/config/mcp_config.json` 配置。详见 `templates/antigravity-*`
- **最小化**：只复制 `SKILL.md` + `references/anti-fabrication.md` 到任意项目，已能解决 80% 问题

## 不做什么

- 不包揽"截图直接生成代码"——本 skill 假定你有 Figma MCP 或至少有 Dev Mode 导出。纯截图场景走 `fallback-bitmap-only.md`。
- 不替代 design-system——本 skill 强制调用现有 registry，不替你造组件库。
- 不内建 Figma API 调用——MCP 工具调用由宿主 agent 负责，本 skill 只规定流程与约束。
