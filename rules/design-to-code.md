<!--
  Antigravity workspace rule. 放到 .agents/rules/design-to-code.md
  激活模式建议在 IDE 里设为 "Always On"（每次会话常驻），或 "Model Decision"（按需触发）。
  单文件 ≤12000 字符，本文件远小于上限。
  skill 路径随安装方式而定：plugin 内置用 .agents/plugins/design-to-code/skills/design-to-code/SKILL.md，
  用户级用 ~/.gemini/config/skills/design-to-code/SKILL.md 或 ~/.agents/skills/design-to-code/SKILL.md。
-->

# Design-to-Code 工作约束（Antigravity workspace rule）

当任务是把 Figma 设计稿或 UI 截图还原成前端代码时，加载并遵循 `design-to-code` skill（路径见上方注释，按你的安装方式选其一）。

## Fusion 主旨

两条信息源各管一摊，冲突按规则裁决不投票：

- **截图定结构与布局**（父子嵌套、视觉分组、对齐、相对间距、层级）
- **Figma MCP / Dev Mode 导出的 ground-truth.json 定精确数值**（颜色/字号/圆角/间距像素值）
- 冲突时结构听截图、数值听 ground-truth

## 反捏造四红线（与 GEMINI.md 的 "No hardcoded values" 协同）

1. **禁占位图 URL** — `placeholder.com` / `via.placeholder` / `placehold.co` / `picsum.photos` / `loremflickr` / `unsplash.com` 随机图一律不准。无资源时用 `<div role="img">` + `<!-- TODO: replace with asset from <nodeId> -->`，并记入 `missing-assets.md`。
2. **禁凭空文案** — 只复制截图可见的逐字内容。不编产品名、按钮文案、错误提示、版权年份。lorem ipsum 不当真实文案写进代码。
3. **禁新造 design-system 之外的同名组件** — 只用 design-system registry 列出的组件。registry 没有→用语义化原生标签 + `<!-- TODO: 替换为 design-system XXX -->` 注释。绝不凭空造一个同名组件。
4. **禁凭空精确数值** — 每个颜色/字号/圆角/间距值必须满足其一：(a) 在 `design-ground-truth.json` 有出处（注释 `/* from nodeId */`）；(b) 是 design-system token；(c) 显式标 `<!-- 截图估读 -->` 并记入 `pending-review.md`。

> 与 `~/.gemini/GEMINI.md` 的 "No hardcoded values (use constants or config)" 一致——本规则进一步要求这些 constants/config 来自 Figma ground-truth 而非凭空。

## 交付前必做

1. 跑 `node scripts/verify-ground-truth.js <code-dir> design-ground-truth.json`，`[UNMATCHED]` 必须清零
2. headless 渲染生成页 → 与截图视觉 diff → 结构差异必须纠正（像素级颜色差异可忽略）
3. 交付物清单：代码 + `design-ground-truth.json`（有源时）+ `missing-assets.md` + `pending-review.md` + verify 输出

## 已就位的基础设施

- **Figma MCP**：`~/.gemini/config/mcp_config.json` 已配你自己的 Figma MCP server（具体实现与 token 不在本 plugin 内），直接调用取设计上下文
- **skill 完整文件**：`~/.gemini/config/skills/design-to-code/SKILL.md` + `references/` + `scripts/verify-ground-truth.js`
- **hook 自动护栏**（可选，见 `templates/antigravity-hooks.json`）：PreToolUse 硬拦占位图/lorem，PostToolUse 单文件扫描反馈

## 触发方式

- 自动：本 rule 设为 `Always On` 即每次会话常驻；skill 由模型按 description 触发
- 手动：在 Agent 输入框 `@design-to-code` 强制加载 skill（Antigravity 无自定义 slash command，用 @提及替代）
