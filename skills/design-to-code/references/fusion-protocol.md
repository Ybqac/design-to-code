# Fusion Protocol — 截图与 MCP 代码的融合规则

## 核心原则

两条信息源各管一摊，**冲突时不投票、按规则裁决**：

| 信息维度 | 听谁的 | 原因 |
|---|---|---|
| 组件树结构、父子嵌套 | **截图** | MCP 在设计没用 auto-layout 时会乱套层级 |
| 视觉分组、卡片边界 | **截图** | MCP 常把本该独立的卡片并到同一容器 |
| 主轴方向（row/column） | **截图** | Framelink #232 已知会算反交叉轴 |
| 对齐方式（start/center/between） | **截图** | 看 flex justify 而非猜 |
| 元素是否换行、是否等高 | **截图** | 设计不规范时 MCP 给不出正确 wrap/grow |
| 颜色、字号、字重、字族 | **ground-truth.json** | 截图受压缩/色彩管理影响不可信 |
| border / radius / shadow 精确值 | **ground-truth.json** | 截图无像素精度 |
| 间距精确像素值 | **ground-truth.json** | 但**间距的存在性和分组关系**听截图 |
| z-index / opacity / blend | **ground-truth.json** | 截图无法还原层叠 |
| 文案逐字内容 | **截图** | 截图里看得见的字才能写，ground-truth 也只是核对 |

裁决一句话：**结构听截图，数值听 ground-truth，冲突时结构优先**。

## 第 3 步：结构化布局描述的格式

视觉读图阶段，**只输出以下结构化描述，不给精确数值**。这是为了不和 ground-truth.json 串值。

```yaml
layout:
  root:
    type: container
    direction: column          # row | column
    align: stretch             # start | center | end | between | stretch
    gap: tight                 # tight | normal | loose（相对判断，不给像素）
    children:
      - type: header
        role: nav-bar
        height: fixed          # fixed | auto | stretch
        children:
          - { type: text, role: logo, align-self: start }
          - { type: nav-list, direction: row, gap: normal, align: center }
          - { type: action-group, direction: row, align: end }
      - type: main
        direction: column
        gap: loose
        children:
          - type: card
            border: visible
            padding: normal
            children:
              - { type: text, role: title, weight: bold }
              - { type: text, role: body }
              - { type: action-group, direction: row, justify: between }
      - type: footer
        role: tab-bar
        direction: row
        justify: between
        height: fixed
visual_notes:
  - "header 和 main 之间有 0 间距，紧贴"
  - "card 内 title 和 body 之间间距小于 body 和 action-group 之间"
  - "tab-bar 当前选中态：第 2 项"
  - "整体背景比 card 背景深一档"
missing_from_screenshot:
  - "无法判断 hover 态、disabled 态、loading 态"
  - "无法判断长文案截断规则"
```

要点：
- 只用相对词（tight/normal/loose、fixed/auto/stretch）描述尺寸和间距，**绝不报像素**
- 用 `role` 标注语义角色（nav-bar/tab-bar/logo/title），落代码时映射到 design-system 组件
- `visual_notes` 记录截图里看得到但结构描述表达不了的细节
- `missing_from_screenshot` 显式列出截图没覆盖的态，避免凭空补全

## 第 4 步：冲突仲裁清单

fusion 时遇到下列情况按此处理：

1. **MCP 把两个明显独立的卡片放在同一容器** → 拆开，按截图分组各自成容器
2. **MCP 的 flex-direction 与截图视觉方向相反** → 听截图，并在交付说明里标注"MCP 节点 `<nodeId>` 方向疑似错误，已按截图修正"
3. **ground-truth 给的 gap 与截图视觉间距明显不符**（如 ground-truth=4px 但截图看明显宽） → 听 ground-truth 的值，但在交付说明里标"疑似 nodeId 漏标 padding，待核实"
4. **截图里的元素 ground-truth.json 完全没有**（设计师临时加的、或 MCP 截断未导出） → 用语义化原生标签实现，所有数值标"截图估读"，列进 `待核实` 清单
5. **截图里的文案 ground-truth.json 里是占位 lorem** → **听截图的真实文案**，不能把 lorem 写进代码

## 第 7 步：回环验证的判据

headless 渲染后与截图做视觉 diff，重点看：
- 顶层布局方向是否一致（最容易错）
- 卡片边界、分组是否一致
- 当前选中态、禁用态位置是否一致
- 文案是否漏字/多字

像素级颜色差异不必纠正（截图色彩不可信）。布局结构差异必须纠正。
