<!-- design-to-code fragment for Antigravity / Gemini CLI. 手动并入 ~/.gemini/GEMINI.md（不要覆盖，追加到末尾或合适章节）。注意与已有的 "No hardcoded values (use constants or config)" 协同。 -->

## Design-to-Code 工作约束（Antigravity 全局）

当任务是把 Figma 设计稿或 UI 截图还原成前端代码时，加载并遵循 `design-to-code` skill（`~/.gemini/config/skills/design-to-code/SKILL.md`）。核心约束：

1. **Fusion 融合**：截图定结构与布局，Figma MCP / Dev Mode 导出的 `design-ground-truth.json` 定精确数值。冲突时结构听截图、数值听 ground-truth。
2. **反捏造四红线**（与上方 "No hardcoded values" 一致并强化）：
   - 禁占位图 URL（placeholder/picsum/unsplash 等），无资源用 `<div>` + `<!-- TODO: nodeId -->`
   - 禁凭空文案，只复制截图可见的逐字内容
   - 禁新造 design-system 之外的同名组件，只能用 registry 列出的
   - 禁凭空精确数值，每个颜色/字号/圆角/间距必须在 `design-ground-truth.json` 有出处，或显式标"截图估读"
3. **校验**：交付前跑 `node scripts/verify-ground-truth.js <code-dir> design-ground-truth.json`，`[UNMATCHED]` 必须清零。
4. **回环**：headless 渲染生成页 → 与截图视觉 diff，布局结构差异必须纠正，像素级颜色差异可忽略。

skill 完整文件：`~/.gemini/config/skills/design-to-code/SKILL.md`，按需读取其 `references/`。
