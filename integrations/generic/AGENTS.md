# design-to-code（dtc）工作流片段

把本片段放进任意 agent 宿主的指令文件（AGENTS.md / GEMINI.md / 系统提示），获得同一套闭环纪律。步骤与 `integrations/cursor/rules-global/dtc-workflow.mdc` 同一顺序。

## 工具链

CLI 命令名：`dtc`。references 源：仓库内相对路径 `skills/design-to-code/references/`。MCP 由 `dtc setup` 写入用户目录的 `mcp.json`（`node` + `packages/mcp/dist/server.js` 绝对路径）。

## 纪律（按序，不可跳步）

1. **doctor** — `dtc doctor`。relay 用 `dtc relay start`（3055 已有监听则复用）。通道用 `dtc plugin install`，主推 Figma 桌面 App Import manifest。
2. **取源** — `dtc extract --node <id>` 产出 `.dtc/` 规格包（spec / ground-truth / 参考图 / 素材）。选中的节点先 `dtc sel`。
3. **4 行闸口** — 结构描述写入 `.dtc/structure.yaml` 给用户确认后再生成代码（防「假融合」：模型可能声称按截图重写了布局，实际沿用错误结构）。对话只报 4 行。
4. **生成** — 按 dtc-workflow 的技术栈 6 条：框架、样式方案、设计 token 接入、组件惯例、路由/目录、单位。数值取 ground-truth 注释 nodeId；文案逐字 spec；素材用 .dtc/assets。
5. **verify** — `dtc verify --url <实现页>` 闭环修复，直到 exit=0（收敛）或 exit=2（停下报告剩余差异，禁止谎报完成）。
6. **check** — `dtc check <代码目录>`：占位图与未溯源数值机械红线。
7. **交付报告** — 文件、分数、轮次、check 结果、剩余差异。

## 四红线

禁占位图 / 禁编文案 / 禁造组件 / 禁凭空数值（出处或标「截图估读」）。
