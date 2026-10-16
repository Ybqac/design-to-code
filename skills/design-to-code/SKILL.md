---
name: design-to-code
description: 把 Figma 设计稿或 UI 截图高保真还原成前端代码时使用。dtc 工具链闭环：确定性提取（dtc extract 产 ground-truth 数值锁+spec+真实素材）→ 结构人工确认闸口 → 生成 → 视觉回归闭环（dtc verify 像素diff+nodeId归因+fix-prompt）→ 反捏造校验（dtc check）。当用户提到 Figma、设计稿、截图转代码、还原页面、figma、视觉稿、UI 实现、设计还原时触发。
---

# Design-to-Code（dtc 工具链闭环）

## 定位

fusion 双源思想不变：**截图定结构与布局，节点树定数值 ground-truth**。升级点：执行层已工具化——模型不再手抄节点数据、不再"自觉"截图对比，一律跑 CLI：

| 步骤 | 命令 | 说明 |
|---|---|---|
| 1 自检 | `dtc doctor` | relay + Figma 插件（channel `dtc`）+ chromium |
| 2 提取 | `dtc extract --node 14669-9900` | 直连 relay：节点树+参考图+素材 → `.dtc/`，ground-truth 100% 脚本生成 |
| 3 结构确认 | （人工闸口） | 完整结构写 `.dtc/structure.yaml` 过溯源校验；**对话只报数量摘要**（见下），确认后才生成 |
| 4 生成 | （模型） | 跟随目标项目技术栈；数值查 ground-truth；素材用 .dtc/assets |
| 5 验证环 | `dtc verify --url <实现页>` | 像素diff→热区→nodeId归因→fix-prompt；循环至 exit=0 收敛 / exit=2 停滞 |
| 6 反捏造 | `dtc check <代码目录>` | 溯源校验 + 硬编码值反查 + 占位图红线 |
| 7 交付报告 | （模型） | 文件清单、分数与轮次、check 结果、剩余差异 |

CLI 入口：`node ~/code/design-to-code-plugin/packages/cli/dist/bin.js <cmd>`（MCP 形态见 `integrations/cursor/mcp.json`）。

## 4a 闸口：细节进文件，对话只报数量

结构描述 YAML 必须**内嵌 ground-truth 具体数值**（nodeId + 颜色 + 尺寸 + 圆角 + 字体），禁止笼统标签；完整内容写入 `.dtc/structure.yaml`，然后跑：

```bash
node skills/design-to-code/scripts/verify-yaml-provenance.js .dtc/structure.yaml .dtc/raw-node-snapshot.json
```

脚本逐个核对 YAML 里的 hex 颜色与尺寸是否在原始节点树有出处，编的值 `[FORGED]` 报红退出 1（实测模型 11 个颜色能编 10 个——软约束挡不住，机械闸口才是硬门槛）。

**对话里只输出 4 行**（禁止逐项罗列颜色/字号/文案清单，用户自己看 YAML）：
1. 选中节点名 + nodeId + 尺寸
2. 一两句话结构概览
3. `溯源校验：N 个颜色 / M 个尺寸全部通过，0 伪造`（或 `X 个未溯源已标注待核实`）
4. `完整结构见 .dtc/structure.yaml，确认后生成代码`

## .dtc/ 规格包（工具产物，禁止手改）

- `spec.json` — 结构+样式+布局。`layout`=auto-layout（确定性）；`layoutHint.inferred=true`=几何推断（[AI 推断]，`unknown` 时以参考图为准）。
- `design-ground-truth.json` — 数值锁（v3，含 bbox/effects/paddingPx，归因用）。生成代码时的**唯一数值依据**。
- `ref/frame.png` — 参考图（结构判断源）。
- `assets/` — IMAGE fill / VECTOR / 图形 INSTANCE 的真实切图。
- `verify/` — report-N.json、diff.png、impl.png、fix-prompt.md。

## 数据通道

主通道：TalkToFigma relay（ws://localhost:3055，内置 `dtc relay start` 或复用已有 bun socket + Design-to-Code Bridge 插件连 channel `dtc`）。插件装法见 `dtc plugin install` / `dtc setup`。备份：`dtc extract --from-rest --file-key X --pat <PAT>`（受 Figma 限流）。兜底：`--from-snapshot <json>`。

## 反捏造四红线

详见 `references/anti-fabrication.md`：禁占位图（用 .dtc/assets）；禁编文案（逐字 spec）；禁造组件（用项目组件库）；禁凭空数值（ground-truth 出处或标"截图估读"）。红线 1/4 由 `dtc check` 机械强制。

## references 索引

- `references/fusion-protocol.md` — 截图 vs 节点数据的冲突仲裁规则与结构描述格式
- `references/anti-fabrication.md` — 四红线完整版（正反例）
- `references/ground-truth-lock.md` — ground-truth v3 机制（自动生成、查值用法、溯源校验）
- `references/framework-react.md` / `framework-vue.md` / `framework-miniapp.md` — 目标栈生成细则
- `references/fallback-bitmap-only.md` — 纯位图无源文件兜底
- `scripts/verify-yaml-provenance.js` — 4a 结构 YAML 溯源校验（零依赖，配合 .dtc/raw-node-snapshot.json）

## 不做什么

- 不手写 ground-truth / 不手改 .dtc/（工具产物，改了会被溯源校验抓）
- 不在 verify 未跑或未收敛时声称"已完成还原"
- 不替代目标项目的设计系统；只按其惯例还原
