---
name: design-to-code
description: 把 Figma 设计稿高保真还原成前端代码的闭环工作流（dtc 工具链）。当用户提到 Figma、设计稿、截图转代码、还原页面、设计还原、UI 实现时使用。核心：确定性提取（dtc extract）→ 结构人工确认 → 生成 → 视觉回归闭环（dtc verify，含 nodeId 归因的 fix-prompt）→ 反捏造校验（dtc check）。
---

# Design-to-Code（dtc 工具链闭环）

宿主无关版。CLI 优先：`dtc extract / verify / check / doctor / plugin`（仓库 `~/code/design-to-code-plugin`，`node packages/cli/dist/bin.js <cmd>`）。

## 流程（严格按序）

1. **doctor** — `dtc doctor`。relay（`bun socket` 于 ~/code/cursor-talk-to-figma-mcp）+ Figma 插件（channel `dtc`）+ chromium 必须就绪。
2. **extract** — `dtc extract --node <14669-9900> [--channel dtc]` → `.dtc/`：spec.json / design-ground-truth.json / ref/frame.png / assets/。
3. **【人工闸口】** 读 spec + 参考图，输出结构描述（层级 + 布局模型 + 关键数值内嵌）给用户确认；确认后才生成代码。布局模型优先级：`layout`（auto-layout，确定性）> `layoutHint`（[AI 推断]，结合参考图校验）> 截图目测。
4. **生成** — 检测目标项目技术栈并跟随其惯例；数值取 ground-truth（注释 nodeId）；文案逐字取 spec；素材用 .dtc/assets 真图。
5. **verify 闭环** — `dtc verify --url <实现页>`；exit=1 按 fix-prompt（带 nodeId + 期望/实际值）修复后重跑；exit=0 收敛；exit=2 停下向用户报告剩余差异。
6. **check** — `dtc check <代码目录>` 反捏造：占位图红线 + 硬编码值溯源。
7. **交付报告** — 文件清单、分数与轮次、check 结果、剩余差异。

## 反捏造四红线

禁占位图（用 .dtc/assets）；禁编文案（逐字 spec）；禁造组件（用项目组件库）；禁凭空数值（ground-truth 出处或标"截图估读"）。

详见仓库 `skills/design-to-code/references/`（anti-fabrication / fusion-protocol / ground-truth-lock / framework-*）。
