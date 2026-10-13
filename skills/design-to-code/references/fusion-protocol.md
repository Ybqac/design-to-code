# Fusion Protocol — 截图与节点数据的融合规则

## 核心原则

两条信息源各管一摊，**冲突时不投票、按规则裁决**：

| 信息维度 | 听谁的 | 原因 |
|---|---|---|
| 组件树结构、父子嵌套 | **spec.layout（auto-layout）> 截图** | 设计规范用了 auto-layout 时它是确定性事实；缺失时节点层级不可信，听截图 |
| 视觉分组、卡片边界 | **截图** | 无 auto-layout 时节点树常把独立卡片并进同一容器 |
| 主轴方向（row/column） | **spec.layout.mode > 截图** | 同上；`layoutHint`（[AI 推断]）与截图冲突时听截图 |
| 对齐方式（start/center/between） | **截图**（layout 的 align 字段缺失时） | 看 flex justify 而非猜 |
| 元素是否换行、是否等高 | **截图** | 设计不规范时数据给不出正确 wrap/grow |
| 颜色、字号、字重、字族 | **design-ground-truth.json** | 截图受压缩/色彩管理影响不可信 |
| border / radius / shadow 精确值 | **design-ground-truth.json** | 截图无像素精度 |
| 间距精确像素值 | **design-ground-truth.json** | 但**间距的存在性和分组关系**听截图 |
| z-index / opacity / blend | **design-ground-truth.json** | 截图无法还原层叠 |
| 文案逐字内容 | **spec.text.content** | 数据里有的逐字用；截图里可见而数据缺失的听截图 |

裁决一句话：**结构听确定性 auto-layout，其次截图；数值一律听 ground-truth；冲突时结构优先**。

## 第 3 步：视觉读图（无像素）

读 `.dtc/ref/frame.png`，只输出相对结构判断，不报像素（避免与 ground-truth 串值）。对照 `spec.json` 的树与 `layoutHint`，标出两者分歧点。相对词只用 tight/normal/loose、fixed/auto/stretch。

## 第 4a 步：结构描述（人工闸口的输出，内嵌数值）

融合后的结构 YAML **必须内嵌 ground-truth 具体数值**，否则生成阶段又要凭空猜：

```yaml
- type: button
  nodeId: "14669:1005"
  role: button
  styles: { background: "#3b82f6", radius: 8, size: "312x44" }   # ← 来自 ground-truth raw_styles
  text: { content: "登录", fontSize: 14, fontWeight: 500, color: "#ffffff" }
  children: ...
```

- 每个视觉元素（卡片/按钮/输入框/badge/进度条…）的 YAML 节点必须含：nodeId + 颜色 + 尺寸 + 圆角 + 字体（从对应 raw_styles 条目取）。
- 布局模型标注来源：`layout`（设计稿事实）或 `layoutHint [AI 推断，confidence]` 或 `[截图目测]`。
- 输出后明确请用户确认："结构对了再生成代码。"

## 冲突仲裁清单

1. **无 auto-layout 数据下，两个明显独立的卡片被放进同一容器** → 拆开，按截图分组
2. **layoutHint 的方向与截图视觉方向相反** → 听截图，交付说明标注"节点 `<nodeId>` 几何推断与截图不符，已按截图修正"
3. **ground-truth 的 gap 与截图视觉间距明显不符**（如 gap=4px 但视觉明显宽） → 疑似节点漏标 padding：值听 ground-truth，交付说明列"待核实"
4. **截图里的元素 ground-truth 完全没有** → 语义化原生标签实现，数值全标"截图估读"，进待核实清单
5. **数据里文案是占位 lorem 而截图有真实文案** → 听截图

## 第 5 步：回环验证（dtc verify 机械执行）

`dtc verify` 自动完成截图/diff/归因/fix-prompt。判读 report 时：
- 顶层布局方向、卡片分组的热区（high severity）必须修复
- 文本类细微色差看 structure.mismatches（DOM 值比对，比像素更可靠）
- 像素级抗锯齿底噪（low、面积小）可说明后忽略
- exit=0 收敛交付；exit=2 停滞时如实报告剩余差异，禁止谎报完成
