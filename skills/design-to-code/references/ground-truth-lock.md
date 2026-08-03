# Ground-Truth Lock — 把"别捏造"变成机械校验

## 为什么需要

口头说"别凭空捏造数值"模型偶尔会忘了。改用结构性约束：**从 Figma 导出一份精确值清单，落盘成 JSON，每个值带出处 nodeId**。生成代码时强制每个数值要么对得上这份清单，要么显式标"估读"。这样就机械可校验，不靠模型自觉。

## 如何导出 design-ground-truth.json

用 Framelink MCP 的 `get_figma_data` 工具取数据，REST API 兜底：

```
1. Framelink MCP：调 get_figma_data(fileKey, nodeId) → 拿节点树 layout/styling/content/component
   - fileKey 从 URL 提取：figma.com/(file|design)/<fileKey>/...
   - nodeId 从 URL 参数提取：?node-id=12-345 → 改成 12:345（破折号换冒号）
   - 返回的 JSON 已被 Framelink 简化为模型友好的结构（含 fills/strokes/layout/typography/content）
2. 兜底 REST API：GET https://api.figma.com/v1/files/<file_key>/nodes?ids=<nodeIds>
   → 遍历 nodes[].document，把 fills/strokes/effects/layoutGeometry 抽出来
   （当 Framelink 不可用、或返回被截断时用）
```

**注意工具名**：Framelink v0.13.2 只暴露 `get_figma_data` 和 `download_figma_images` 两个工具——**没有 `get_variable_defs` / `get_design_context` / `get_node_screenshot`**（那些是 Figma 官方 MCP 的工具名，不要写错）。

导出后落盘项目根 `design-ground-truth.json`，schema 见 `templates/ground-truth.schema.json`。样例（v2 schema，raw_styles 按节点+角色标注）：

```json
{
  "source": {
    "figma_file": "abc123",
    "frame_node_id": "12:345",
    "exported_at": "2026-08-03T10:00:00Z",
    "via": "framelink get_figma_data"
  },
  "tokens": {
    "colors": [
      { "name": "primary", "value": "#6E29F6", "nodeId": "1:2" },
      { "name": "text-primary", "value": "#0D0D0D", "nodeId": "1:3" },
      { "name": "border-gray", "value": "#D9D9D9", "nodeId": "1:4" }
    ],
    "typography": [
      { "name": "Body Regular", "fontSize": 14, "fontWeight": 400, "lineHeight": 24, "nodeId": "2:2" },
      { "name": "Title S", "fontSize": 20, "fontWeight": 600, "lineHeight": 32, "nodeId": "2:1" }
    ],
    "spacing": [
      { "name": "gap-md", "value": 12, "nodeId": "3:1" }
    ],
    "radius": [
      { "name": "card", "value": 20, "nodeId": "1:2" }
    ]
  },
  "raw_styles": [
    {
      "nodeId": "1:2",
      "name": "Recharge Card",
      "role": "card",
      "fills": [
        { "color": "#FFFFFF", "role": "background" },
        { "color": "rgba(0,0,0,0.16)", "role": "shadow" }
      ],
      "strokes": [
        { "color": "#D9D9D9", "role": "border", "width": 1 }
      ],
      "cornerRadius": 20,
      "padding": "20px 16px",
      "layoutMode": "vertical"
    },
    {
      "nodeId": "1:5",
      "name": "Submit Button",
      "role": "button",
      "fills": [
        { "color": "linear-gradient(90deg,#02F6F7,#E2B0FF)", "role": "background" }
      ],
      "strokes": [],
      "cornerRadius": 22,
      "textColor": "#1E1B4B",
      "textStyle": { "ref": "Body Regular", "fontSize": 14, "fontWeight": 700 }
    },
    {
      "nodeId": "1:6",
      "name": "Order ID",
      "role": "text",
      "fills": [],
      "strokes": [],
      "textColor": "#0D0D0D",
      "textStyle": { "ref": "Body Regular", "fontSize": 14, "fontWeight": 400 }
    }
  ]
}
```

## 字段说明（v2 schema）

- `tokens`：扁平的值清单，按类别分组（colors / typography / spacing / radius）。`name` 是给代码引用的别名，但**只记值不记应用关系**——"白底灰边"这种应用关系在 `raw_styles` 里
- `raw_styles`：**按节点**记录的角色化样式。每个节点一条，是 ground-truth 的核心——让模型生成 CSS 时不用靠截图猜"白底灰边"的应用关系，直接查每个节点的 `fills[role=background]` / `strokes[role=border]`
  - 必填字段：`nodeId`（必须是真实 Figma `1234:5678` 格式，不接受英文后缀）、`role`（语义角色）、`fills`
  - `fills` 每条带 `role` 标注：`background` 主背景 / `surface` 卡片表面 / `shadow` 阴影 / `overlay` 蒙层
  - `strokes` 每条带 `role` 标注：`border` 卡片边框 / `divider` 分割线 / `outline` 外描边
  - TEXT 节点额外填 `textColor` + `textStyle`（引用 tokens.typography 的 name）
  - 布局字段：`cornerRadius` / `padding` / `gap` / `layoutMode`
- **raw_styles 必须逐节点生成**（不止 1 条）。少于 10 条视为偷懒，verify 脚本会报警。

样例（v2 raw_styles）：

```json
"raw_styles": [
  {
    "nodeId": "1:2",
    "name": "Recharge Card",
    "role": "card",
    "fills": [
      { "color": "#FFFFFF", "role": "background" },
      { "color": "rgba(0,0,0,0.16)", "role": "shadow" }
    ],
    "strokes": [
      { "color": "#D9D9D9", "role": "border", "width": 1 }
    ],
    "cornerRadius": 20,
    "padding": "20px 16px",
    "layoutMode": "vertical"
  },
  {
    "nodeId": "1:3",
    "name": "Submit Button",
    "role": "button",
    "fills": [
      { "color": "linear-gradient(90deg,#02F6F7,#E2B0FF)", "role": "background" }
    ],
    "strokes": [],
    "cornerRadius": 22,
    "textColor": "#1E1B4B",
    "textStyle": { "ref": "Body M", "fontSize": 14, "fontWeight": 700 }
  },
  {
    "nodeId": "1:4",
    "name": "Order ID Text",
    "role": "text",
    "fills": [],
    "strokes": [],
    "textColor": "#0D0D0D",
    "textStyle": { "ref": "Body Regular", "fontSize": 14, "fontWeight": 400 }
  }
]
```

**关键**：`role` + `fills[role]` + `strokes[role]` 让模型从"查到 `#FFFFFF` 在 tokens 里但不知道用在哪"升级到"节点 1:2 是 card、bg=#FFFFFF、border=#D9D9D9"——不再靠截图猜应用关系。

## 如何用它锁定代码

### 模型生成代码时的规则

实现每处需要数值的地方，按以下顺序取值：

1. ground-truth.json 里有对应 token → 用 token 名（如 `bg-primary` / `text-sm`）
2. ground-truth.json 里 raw_styles 有同 nodeId 的精确值 → 用精确值，注释标 `/* from nodeId */`
3. 都没有 → 用语义化 token（design-system 提供）+ 注释 `/* 截图估读，待核实 */`，并加进 `pending-review.md`

### 跑校验脚本

```bash
node scripts/verify-ground-truth.js <code-dir> <ground-truth.json>
```

脚本扫 `<code-dir>` 下的 `.tsx/.jsx/.vue/.wxml/.css/.module.css`，提取所有硬编码的 hex 颜色、px 字号、px 圆角、px 间距，逐一反查 ground-truth.json 的 tokens + raw_styles，输出未匹配清单：

```
[UNMATCHED] src/components/Card.tsx:14  bg-[#FF0000]   (no token, no raw_style)
[UNMATCHED] src/components/Card.tsx:18  text-[13px]    (closest token: body=14)
[PENDING]   src/components/Nav.tsx:8    gap-2          <!-- 截图估读 -->  (acknowledged)
```

`[UNMATCHED]` 是必须处理的红线；`[PENDING]` 是模型已主动标注的估读，可接受但要进交付清单。

## MCP 拿不到 ground truth 怎么办

按可获取程度降级：

1. Framelink 的 `get_figma_data` 返回截断 → 用 `depth` 参数控制深度，或拆小 frame 一段段取，合并落盘
2. Framelink 拿到的数据缺关键字段 → 兜底走 Figma REST API（`GET /files/<key>/nodes?ids=...`）取原始 JSON
3. 用户给的 Figma 链接无法访问（权限/token 失效） → 告诉用户截图+链接都需要，落空 ground-truth.json，按 `references/fallback-bitmap-only.md` 走位图兜底

