---
description: 把 Figma 设计稿或 UI 截图还原成前端代码，强制加载 design-to-code skill 的完整流程
argument-hint: [<截图路径|Figma链接>]
---

# /figma 命令 — design-to-code 强制入口

用户用 `/figma` 强制加载 design-to-code 工作流，绕过自动触发的判断。

## 你接下来要做的

1. **立即加载 design-to-code skill**：读 `~/.agents/skills/design-to-code/SKILL.md`，并按其索引先读 `references/fusion-protocol.md` 和 `references/anti-fabrication.md` 两份必读文件。
2. **解析参数**：
   - 第一个参数若是 URL → 当作 Figma 链接，走 MCP 取节点树（取源 → 导出 ground truth）
   - 第一个参数若是图片路径 → 当作截图，配合已提供的或后续询问的 Figma 链接；若无任何链接则进入纯位图兜底模式（读 `references/fallback-bitmap-only.md`）
   - 无参数 → 询问用户提供截图或 Figma 链接，并确认目标框架（React / Vue / 小程序）
3. **目标框架识别**：读 `references/framework-{react|vue|miniapp}.md` 对应的一份。
4. **走完 7 步主流程**：取源 → 导出 ground truth → 视觉读图（只出结构化布局描述，不给像素）→ fusion → 生成代码 → 跑 `scripts/verify-ground-truth.js` → headless 渲染回环验证。
5. **交付物清单**：
   - 生成的代码
   - `design-ground-truth.json`（如果有 Figma 源）
   - `missing-assets.md`（占位 TODO 清单 + 对应 nodeId）
   - `pending-review.md`（所有 `[PENDING]` 估读项 + 截图裁切未补全文案）
   - verify-ground-truth.js 的输出（`[UNMATCHED]` 必须为零）

## 反捏造四红线（每个交付都要过）

- 禁占位图 URL（placeholder/picsum/unsplash 等）
- 禁凭空文案（只复制截图可见的逐字内容）
- 禁新造 design-system 之外的同名组件
- 禁凭空精确数值（每值在 ground-truth.json 有出处或显式标"截图估读"）

## 不可跳过的检查

- 交付前必须跑 `node ~/.agents/skills/design-to-code/scripts/verify-ground-truth.js <code-dir> design-ground-truth.json`，把输出附在交付报告里
- 若 `[UNMATCHED]` 非零，必须修复后才能交付，禁止把红线项放进 `pending-review.md` 蒙混
