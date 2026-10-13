# design-to-code（dtc）工作流片段

把本片段放进任意 agent 宿主的指令文件（AGENTS.md / GEMINI.md / 系统提示），获得同一套 F2C 闭环纪律。

## 工具链
仓库 `~/code/design-to-code-plugin`；CLI：`node packages/cli/dist/bin.js <cmd>`；MCP：`packages/mcp/dist/server.js`。

## 纪律（按序，不可跳步）
1. `dtc doctor` 自检环境（relay `bun socket` + Figma 插件 channel `dtc` + chromium）。
2. `dtc extract --node <id>` 产出 `.dtc/` 规格包（spec / ground-truth / 参考图 / 素材）。
3. 结构描述给用户确认后再生成代码（防"假融合"：模型可能声称按截图重写了布局，实际沿用错误结构——先让结构过人眼）。
4. 生成时：数值取 ground-truth 注释 nodeId；文案逐字 spec；素材用 .dtc/assets；跟随目标项目技术栈惯例。
5. `dtc verify --url <实现页>` 闭环修复，直到 exit=0（收敛）或 exit=2（停下报告剩余差异，禁止谎报完成）。
6. `dtc check <代码目录>`：占位图与未溯源数值机械红线。
7. 交付报告：文件、分数、轮次、check 结果、剩余差异。

## 四红线
禁占位图 / 禁编文案 / 禁造组件 / 禁凭空数值（出处或标"截图估读"）。
