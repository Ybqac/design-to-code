# /design-to-code —— Figma → 高保真代码（闭环工作流）

把用户给的 Figma 设计还原成本项目技术栈的代码。参数：$ARGUMENTS（Figma 链接 / nodeId；缺省时向用户要）。

**铁律**：数值不猜（ground-truth 说了算）、素材不造（用 .dtc/assets 真图）、结构先确认再写码、验证环必须真实跑。

## 流程（严格按序执行）

### 1. 环境自检
调用 MCP 工具 `dtc_doctor`。若有 ❌ 按提示修复（通常：relay 没起 → 让用户在 `~/code/cursor-talk-to-figma-mcp` 运行 `bun socket`；插件没连 → 让用户在 Figma 里连接 Design-to-Code Bridge 插件，channel 用 `dtc`）。

### 2. 确定性提取
从参数解析 nodeId（`?node-id=14669-9900` → `14669-9900`）。调用 `dtc_extract { node }`。
产物在 `.dtc/`：`spec.json`（结构+样式+布局提示）、`design-ground-truth.json`（数值锁）、`ref/frame.png`（参考图）、`assets/`（真实切图）。
若 extract 报"未检测到 auto-layout 字段"，提醒用户换增强插件（`dtc plugin install`）后重新提取，保真度会更高。

### 3.【人工闸口·不可跳过】结构确认
- 读 `.dtc/spec.json` + 看参考图 `ref/frame.png`。
- 输出**结构描述**给用户确认：层级树 + 每个容器的布局模型（优先 spec 里的 `layout`（设计稿 auto-layout，确定性）；其次 `layoutHint`（标了 `[AI 推断]`，需你结合参考图校验）；关键元素内嵌具体数值（颜色/字号/圆角/间距，取自 spec）。
- 明确问用户："结构确认无误后我再生成代码"。用户确认后才进步骤 4。

### 4. 生成代码
- 先检测本项目技术栈（package.json 依赖、现有组件写法、样式方案），沿用项目惯例（组件划分、命名、样式方案、设计 token 接入方式）。
- 布局：按 spec 的 layout/layoutHint 写 flex/grid，不要照抄绝对定位（除非 hint 是 absolute）。
- 数值：颜色/字号/圆角/间距一律从 spec/ground-truth 取，注释 `/* from nodeId */`；不在数据里的标注 `截图估读`。
- 文案：逐字用 spec 的 `text.content`，禁止编造。
- 素材：用 `.dtc/assets/` 的真实文件，禁止占位图/通用 SVG。
- 组件化：识别重复模式抽成组件，加 hover/focus 等状态。

### 5.【验证环·不可跳过】
起本地服务（或直接用 html 文件），调用 `dtc_verify { url }`：
- 读返回摘要 + `dtc_fix_prompt`，按归因修复（每条带 nodeId 和期望值）。
- 重复 verify→修复，直到 exit=0（收敛）或 exit=2（停滞，向用户报告剩余差异清单）。
- exit=2 时如实展示 fix-prompt 的差异归因，不要谎称"已修复"。

### 6. 反捏造校验
调用 `dtc_check { code_dir: <生成代码目录> }`。UNMATCHED 项必须处理（换成 ground-truth 值或标估读）。

### 7. 交付报告
输出：生成文件清单、Fidelity Score 与轮次、结构确认记录、check 结果、剩余差异与建议（若有）。
