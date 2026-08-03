---
name: design-to-code
description: 把 Figma 设计稿或 UI 截图还原成前端代码时使用。融合两条信息源——Figma MCP 导出的代码/样式（数值精确但常因设计不规范导致布局错乱）与视觉模型对截图的布局判断（结构正确但无精确像素），二者互补产出页码。当用户提到 Figma、设计稿、截图转代码、还原页面、figma MCP、视觉稿、UI 实现、设计还原、截图生成代码时触发，即使用户没明说"design-to-code"。解决两个高频痛点：MCP 代码样式准但布局乱、以及模型凭空捏造占位图/硬编码文案/臆造组件。
---

# Design-to-Code（Figma 草稿 + 截图视觉互补还原前端）

## 这个 skill 解决什么

把设计稿还原成前端代码时有两条信息源，各有硬伤：

| 信息源 | 强项 | 硬伤 |
|---|---|---|
| Figma MCP 取的节点数据（`get_figma_data`） | 数值精确（颜色/字号/边框/尺寸） | 设计不规范时布局结构错乱（flex 方向反、层级错、间距塌） |
| 视觉模型看截图 | 布局结构、视觉分组、对齐关系判断准 | 无法给精确像素，密集小目标计数不可靠 |

两条都不是单独可信的 ground truth。**主思路是 fusion：截图定结构与布局，MCP 取的精确数值定 ground-truth**。`design-ground-truth.json` 的**主用途是给模型生成代码时查值**——每个节点的背景/边框/字号/圆角/阴影都从这里取，不靠截图猜。**次用途是校验凭证**——生成完后 verify 脚本反查这份文件，抓"模型没查就凭空写的值"。ground-truth 只服务反捏造四红线里的第四条（禁凭空数值），不是反捏造的全部载体。

这套做法与 Figma 官方 MCP 指南的建议方向一致（指南推荐"标记完成前与 Figma 1:1 校验"），并落地了 Framelink 的 `get_figma_data` + `download_figma_images` 两个工具。Fusion + ground-truth 回锁这一融合机制是本项目的设计，未在社区找到完整对标项目。

## 端到端主流程（7 步）

> **关键！f2c 的 `get_code_to_component` 已从 MCP 配置中禁用**（实测证明模型会偷懒直接用 f2c 输出当最终代码，导致布局混乱，且会编造"已按截图修复"的幻觉汇报）。主流程只用 Framelink 取数据 + 模型自己生成代码。需要恢复 f2c 时见下方"f2c 使用纪律"。

1. **取源** — 用户提供截图 + Figma 链接（**截图由用户给，模型不自己调 MCP 取截图**——Framelink v0.13.2 不提供 screenshot 工具）。
   - 调 Framelink 的 `get_figma_data(fileKey, nodeId)` 取节点树（layout/styling/content/component 信息）
   - 从 URL 提取 fileKey（`figma.com/(file|design)/<fileKey>/...`）和 nodeId（`?node-id=<nodeId>`，把 `-` 改成 `:`）
   - 只有截图没链接：跳到第 3 步，并按需读 `references/fallback-bitmap-only.md`
2. **导出 ground truth** — 把 `get_figma_data` 返回的节点数据**整理成** `design-ground-truth.json`。**关键：raw_styles 必须逐节点生成（不止 1 条）**，每条带 `role`（card/button/text/...）+ `fills[role=background/shadow]` + `strokes[role=border/divider]`——这样模型生成 CSS 时不用靠截图猜"白底灰边"的应用关系，直接查每个节点的 fills/strokes 角色。nodeId 必须是真实 Figma `1234:5678` 格式（纯数字冒号，不接受 `:purple` 英文后缀）。详见 `references/ground-truth-lock.md` 和 `templates/ground-truth.schema.json`。
3. **视觉读图** — 看截图，**只输出结构化布局描述**（父子嵌套、视觉分组、对齐、相对间距、层级关系），**不要给精确像素**——这是 ground-truth 的事。结构化描述示例见 `references/fusion-protocol.md`。
4. **fusion 融合（两阶段，强制用户确认闸口）** —
   - **4a. 输出结构描述给用户确认**：按 `references/fusion-protocol.md` 处理冲突（结构与布局听截图、数值听 ground-truth），输出**结构化布局描述 YAML**（父子嵌套 + 语义角色 + 相对间距 + 冲突仲裁标注），**不生成代码**。明确告诉用户："这是融合后的结构，确认对了再生成代码。"
     - **重要**：如果目标目录已存在旧 HTML/代码（如之前的测试输出），**必须先告诉用户"目录有旧代码，建议清空或换新目录"**，不要在旧代码上打补丁——打补丁会绕过 fusion 结构重写，重复 f2c 残留的布局错误。等用户确认目录处理方式后再继续。
   - **4b. 用户确认后才生成代码**：用户回复"结构对了"或确认后，模型基于确认的结构 + ground-truth.json 数值，**自己写出代码**。数值优先从 ground-truth.json 取（注释 `/* from nodeId */`）；不在 ground-truth 的标"截图估读"。
   - **为什么强制两阶段**：实测证明两个问题：① 模型会声称"已按截图 fusion 修复"但代码实际是 f2c 原样输出；② 模型读到目录有旧 HTML 时，会绕过 fusion 结构重写、走"打补丁"路径，重复 f2c 残留的布局错误。强制 4a 输出结构描述给用户核对，能让"假融合"被当场识破——代码可以对不上截图，但结构描述必须先过用户的眼。
5. **下载真实素材** — 调 `download_figma_images(fileKey, nodes, localPath)` 把截图里看到的图标/图片下到项目约定目录（如 `assets/`、`public/figma-assets/`）。**不要用 picsum/placeholder**——这是反捏造红线 #1 的正解。
6. **校验护栏** — 跑 `scripts/verify-ground-truth.js` 列未匹配值清单；对照 `references/anti-fabrication.md` 自查占位图/硬编码文案/臆造组件。
7. **回环验证** — headless 渲染生成页 → 与截图视觉 diff → 不一致回到第 4a 步。

## f2c 使用纪律（重要）

**f2c 已从 MCP 配置中禁用**（`~/.gemini/config/mcp_config.json`）。实测原因：模型会偷懒把 f2c 输出当最终代码，且编造"已按截图修复布局"的幻觉汇报——软约束挡不住这种"嘴上 fusion、身体直接用 f2c"的行为。

何时重新启用 f2c（需手动恢复配置）：
- 你明确想要"快速看一眼大致结构"——但 f2c 输出**仅作参考**，必须按截图重写布局
- 想用 f2c 自动下载素材的副作用（Framelink 的 `download_figma_images` 可替代此功能）

恢复方法：
```bash
cp ~/.gemini/config/mcp_config.json.f2c-backup ~/.gemini/config/mcp_config.json
# 重启 Antigravity
```

**严禁**：把 f2c 生成的代码直接交付、或把 f2c 输出当成 fusion 产物。f2c 输出必须经过"读截图→重写布局→对齐 ground-truth 数值"的 fusion 重写。

## MCP 选择速查

| 想做什么 | 调什么 |
|---|---|
| 取节点树精确数据（颜色/字号/间距/布局）→ ground-truth.json | Framelink `get_figma_data(fileKey, nodeId)` |
| 下截图里看到的图标/图片素材 | Framelink `download_figma_images(fileKey, nodes, localPath)` |
| （可选）快速取代码草稿参考，**不直接用** | f2c `get_code_to_component(componentName, framework, style)` |

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

## scripts/

- `scripts/verify-ground-truth.js` — 零依赖 Node 脚本。用法：`node verify-ground-truth.js <code-dir> <ground-truth.json>`，扫描 .tsx/.jsx/.vue/.wxml/.css，输出未在 ground-truth.json 找到出处的颜色/字号/间距清单。

## templates/（用于把这套规则装进不同工具）

通用三件（ZCode / Claude Code / Cursor）：
- `templates/agents-md-fragment.md` — 注入 `<repo>/AGENTS.md` 或 `~/.zcode/AGENTS.md`
- `templates/claude-md-fragment.md` — 注入 `~/.claude/CLAUDE.md`
- `templates/cursor-rule.mdc` — `.cursor/rules/design-to-code.mdc`
- `templates/zcode-command.md` — ZCode 的 `/figma` slash command
- `templates/ground-truth.schema.json` — `design-ground-truth.json` 的 JSON Schema
- `templates/posttooluse-hook.json` — ZCode PostToolUse hook 配置示例（P3，本 skill 不自动启用）

Antigravity 专属（首选适配）：
- `templates/gemini-md-fragment.md` — 注入 `~/.gemini/GEMINI.md`（与已有的 "No hardcoded values" 协同）
- `templates/antigravity-rule.md` — 复制到 `<repo>/.agents/rules/design-to-code.md`，激活模式设 `Always On`
- `templates/antigravity-hooks.json` — 复制到 `<repo>/.agents/hooks.json`，配 PreToolUse 硬拦 + PostToolUse 反馈
- `templates/antigravity-hook-script.js` — hooks.json 调用的零依赖 Node 脚本（已冒烟测试通过）
- `templates/antigravity-plugin-structure.md` — 打成 Antigravity plugin 的目录结构与安装说明

## 各工具装法速查

- **Antigravity**（首选）：plugin 整包 clone 到 `~/.gemini/config/plugins/`（user 级）或 `<repo>/.agents/plugins/`（workspace 级）；Figma MCP 由用户自行在 `~/.gemini/config/mcp_config.json` 配置。详见 `templates/antigravity-*`
- **ZCode**：skill 已在 `~/.agents/skills/` 可被发现；`zcode-command.md` 复制到 `~/.zcode/commands/figma.md` 作 `/figma`
- **Claude Code**：skill 软链或复制到 `~/.claude/skills/`，`claude-md-fragment.md` 并入 `~/.claude/CLAUDE.md`
- **Cursor**：`cursor-rule.mdc` 复制到 `<repo>/.cursor/rules/design-to-code.mdc`
- **最小化**：只复制 `SKILL.md` + `references/anti-fabrication.md` 到任意项目，已能解决 80% 问题

## 不做什么

- 不包揽"截图直接生成代码"——本 skill 假定你有 Figma MCP 或至少有 Dev Mode 导出。纯截图场景走 `fallback-bitmap-only.md`。
- 不替代 design-system——本 skill 强制调用现有 registry，不替你造组件库。
- 不内建 Figma API 调用——MCP 工具调用由宿主 agent 负责，本 skill 只规定流程与约束。
