---
name: design-to-code
description: 把 Figma 设计稿高保真还原成前端代码的闭环工作流（dtc 工具链）。当用户提到 Figma、设计稿、截图转代码、还原页面、设计还原、UI 实现时使用。核心：确定性提取（dtc extract）→ 结构人工确认 → 生成 → 视觉回归闭环（dtc verify，含 nodeId 归因的 fix-prompt）→ 反捏造校验（dtc check）。
---

# Design-to-Code（dtc 工具链闭环）

CLI 命令名：`dtc`。步骤与 `integrations/cursor/rules-global/dtc-workflow.mdc` 同一顺序。references 源：仓库内相对路径 `skills/design-to-code/references/`。

## 流程（严格按序）

1. **doctor** — `dtc doctor`。relay 用 `dtc relay start`（3055 已有监听则复用）。通道用 `dtc plugin install` 或 `dtc setup`，主推 Figma 桌面 App Import manifest。chromium 未就绪时按其提示安装。
2. **取源** — `dtc extract --node <id> [--channel dtc]`。用户说选中的节点时先 `dtc sel`，再 `dtc extract --selection`。产物 `.dtc/`：spec.json / design-ground-truth.json / ref/frame.png / assets/。
3. **4 行闸口** — 读 spec + 参考图，完整结构写入 `.dtc/structure.yaml` 后给用户确认。布局模型优先级：`layout`（auto-layout，确定性）> `layoutHint`（[AI 推断]，结合参考图校验）> 截图目测。对话只报 4 行（选中节点、结构概览、溯源数量、请确认），确认后才生成。
4. **生成** — 按 dtc-workflow 的技术栈 6 条跟随项目：框架、样式方案、设计 token 接入、组件惯例、路由/目录、单位。数值取 ground-truth（注释 nodeId）；文案逐字取 spec；素材用 .dtc/assets 真图。
5. **verify** — `dtc verify --url <实现页>`。exit=1 按 fix-prompt（nodeId + 期望/实际值）修复后重跑；exit=0 收敛；exit=2 停下向用户报告剩余差异。
6. **check** — `dtc check <代码目录>`。占位图红线 + 硬编码值溯源。UNMATCHED 必须处理。
7. **交付报告** — 文件清单、分数与轮次、check 结果、剩余差异。

## 反捏造四红线

禁占位图（用 .dtc/assets）；禁编文案（逐字 spec）；禁造组件（用项目组件库）；禁凭空数值（ground-truth 出处或标「截图估读」）。

详见仓库内 `skills/design-to-code/references/`（anti-fabrication / fusion-protocol / ground-truth-lock / framework-*）。
