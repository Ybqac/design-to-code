---
name: design-to-code
description: 把 Figma 设计稿或 UI 截图高保真还原成前端代码时使用。dtc 工具链闭环：确定性提取（dtc extract 产 ground-truth 数值锁+spec+真实素材）→ 结构人工确认闸口 → 生成 → 视觉回归闭环（dtc verify 像素diff+nodeId归因+fix-prompt）→ 反捏造校验（dtc check）。当用户提到 Figma、设计稿、截图转代码、还原页面、figma、视觉稿、UI 实现、设计还原时触发。
---

# Design-to-Code（dtc 工具链闭环）

CLI 命令名：`dtc`。

references 源：仓库内相对路径 `skills/design-to-code/references/`。

fusion 双源思想不变：**截图定结构与布局，节点树定数值 ground-truth**。执行层一律跑 CLI，不手抄节点数据。步骤与 `integrations/cursor/rules-global/dtc-workflow.mdc` 同一顺序。

## 流程（严格按序）

1. **doctor** — `dtc doctor`。relay 用 `dtc relay start`（3055 已有监听则复用）。通道用 `dtc plugin install` 或 `dtc setup`，主推 Figma 桌面 App → Plugins → Development → Import plugin from manifest。
2. **取源** — 参数给了链接或 nodeId 就用它：`dtc extract --node <id>`。用户说「选中的/当前这个」或没给参数 → 先 `dtc sel` 确认选区，再 `dtc extract --selection`。产物在 `.dtc/`（spec.json / design-ground-truth.json / ref/frame.png / assets/）。
3. **4 行闸口** — 读 spec.json + ref/frame.png，完整结构（层级 + 数值绑定）写入 `.dtc/structure.yaml`，跑 `node skills/design-to-code/scripts/verify-yaml-provenance.js .dtc/structure.yaml .dtc/raw-node-snapshot.json`。布局模型优先级：`layout`（auto-layout，确定性）> `layoutHint`（[AI 推断]，结合参考图校验）> 截图目测。**对话只报 4 行**：
   1. 选中节点名 + nodeId + 尺寸
   2. 一两句话结构概览
   3. `溯源校验：N 个颜色 / M 个尺寸全部通过，0 伪造`（或 `X 个未溯源已标注待核实`）
   4. `完整结构见 .dtc/structure.yaml，确认后生成代码`
   禁止在对话里逐项罗列颜色/字号/文案。等用户确认再生成。
4. **生成** — 按全局规则 dtc-workflow 的技术栈 6 条跟随项目：框架、样式方案、设计 token 接入、组件惯例、路由/目录、单位。检测结论先说一句再动手。数值取 ground-truth 并注释 nodeId；文案逐字 spec.text.content；素材用 `.dtc/assets/` 真实切图。
5. **verify** — `dtc verify --url <实现页>`。exit=1 → 按 fix-prompt（nodeId + 期望值 vs 实际值）修复后重跑；exit=0 收敛；exit=2 停止并如实报告剩余差异，禁止谎报完成。
6. **check** — `dtc check <代码目录>`。UNMATCHED 必须处理（换成 ground-truth 值或标「截图估读」）。
7. **交付报告** — 文件清单、Fidelity Score 与轮次、check 结果、剩余差异。

## .dtc/ 规格包（工具产物，禁止手改）

- `spec.json` — 结构+样式+布局。`layout`=auto-layout（确定性）；`layoutHint.inferred=true`=几何推断（[AI 推断]，`unknown` 时以参考图为准）。
- `design-ground-truth.json` — 数值锁（v3，含 bbox/effects/paddingPx，归因用）。生成代码时的唯一数值依据。
- `ref/frame.png` — 参考图（结构判断源）。
- `assets/` — IMAGE fill / VECTOR / 图形 INSTANCE 的真实切图。
- `verify/` — report-N.json、diff.png、impl.png、fix-prompt.md。

## 数据通道

主通道：`dtc relay start`（ws://localhost:3055；端口已被占用则复用）+ Design-to-Code Bridge（channel `dtc`）。装通道：`dtc plugin install` 或 `dtc setup`。备份：`dtc extract --from-rest --file-key <key> --pat <PAT>`（受 Figma 限流；PAT 只走该参数）。兜底：`dtc extract --from-snapshot <json>`。

## 反捏造四红线

详见 `references/anti-fabrication.md`：禁占位图（用 .dtc/assets）；禁编文案（逐字 spec）；禁造组件（用项目组件库）；禁凭空数值（ground-truth 出处或标「截图估读」）。红线 1/4 由 `dtc check` 机械强制。

## references 索引

- `references/fusion-protocol.md` — 截图 vs 节点数据的冲突仲裁规则与结构描述格式
- `references/anti-fabrication.md` — 四红线完整版（正反例）
- `references/ground-truth-lock.md` — ground-truth v3 机制（自动生成、查值用法、溯源校验）
- `references/framework-react.md` / `framework-vue.md` / `framework-miniapp.md` — 目标栈生成细则
- `references/fallback-bitmap-only.md` — 纯位图无源文件兜底
- `scripts/verify-yaml-provenance.js` — 4a 结构 YAML 溯源校验（零依赖，配合 .dtc/raw-node-snapshot.json）

以上路径都相对仓库内 `skills/design-to-code/`。

## 不做什么

- 不手写 ground-truth / 不手改 .dtc/（工具产物，改了会被溯源校验抓）
- 不在 verify 未跑或未收敛时声称已完成还原
- 不替代目标项目的设计系统；只按其惯例还原
