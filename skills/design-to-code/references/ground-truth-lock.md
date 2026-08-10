# Ground-Truth — 模型生成代码时的样式查值底本

## 定位（重要：不要本末倒置）

`design-ground-truth.json` 有两个角色，**主次分明**：

| 角色 | 用途 | 何时用 |
|---|---|---|
| **主用途：生成依据** | 模型生成代码时，每个数值从这里**查值**——bg 颜色、border 颜色、字号、圆角、阴影 | 第 4-5 步生成代码时 |
| **次用途：校验凭证** | 生成完后 verify 脚本扫代码反查这份文件，抓"模型没查 ground-truth 凭空写的值" | 第 6 步校验时 |

**主用途是生成依据**——模型写 CSS 需要 bg 颜色，查 ground-truth 拿 #FFFFFF；需要 border 颜色，查同一个节点的 strokes 拿 #D9D9D9。校验只是事后核对：模型理论上应该全查 ground-truth，verify 脚本扫一遍抓没查的。

ground-truth 只服务"反捏造四红线"里的第四条（禁凭空数值），其余三条（禁占位图/禁凭空文案/禁新造组件）与 ground-truth 无关。

## 如何导出 design-ground-truth.json + raw-node-snapshot.json

用 TalkToFigma MCP 的 `read_my_design` 工具取原始节点树，**同时落盘两份文件**：

```
1. TalkToFigma MCP：调 join_channel → 连接 Figma 插件（前置条件）
2. TalkToFigma MCP：调 read_my_design / get_node_info → 读取节点树
3. 落盘 raw-node-snapshot.json：TalkToFigma 返回的原始 JSON 原样保存，不做任何加工
   - 这是溯源基准——ground-truth 的每个值都必须能在这份文件里找到出处
4. 落盘 design-ground-truth.json：从 raw-node-snapshot.json 整理出 tokens + raw_styles
   - raw_styles 必须 >20% 覆盖率（如 346 个节点至少填 70 条）
   - tokens 的每个值必须从 raw-node-snapshot.json 里能找到出处
   - 绝对不允许从生成的代码反向补录值进 ground-truth
5. 兜底：当 TalkToFigma 不可用时，用 Framelink get_figma_data(fileKey, nodeId)（受 Figma REST 限流）
```

## 溯源校验（防反向补录伪造）

生成代码后，跑两道校验：

1. `verify-ground-truth.js <code-dir> <ground-truth.json>` — 扫生成代码的数值是否在 ground-truth 里有出处
2. `verify-gt-provenance.js <ground-truth.json> <raw-node-snapshot.json>` — 拿 ground-truth 和原始节点树快照逐一核对，**抓反向补录伪造**：
   - tokens.colors 的每个值必须在节点树 fills/strokes 里能找到
   - tokens.typography 的每个 fontSize 必须在节点树 style.fontSize 里能找到
   - tokens.spacing / radius 同理
   - raw_styles 覆盖率必须 >20%
   - raw_styles 的每个 nodeId 必须在节点树里存在

第二道校验是关键——之前模型会"先写 CSS，再把 CSS 值反向塞进 ground-truth 骗过第一道校验"。第二道拿原始节点树做基准，反向补录的值在节点树里找不到出处，会被 FORGED 标红。

**TalkToFigma 的 `read_my_design` 返回的是原始 Figma 节点数据**（不是转码后的代码，也不是简化后的摘要），可以直接机械填入 raw_styles，**不需要从代码反推**。

**工具名注意**：TalkToFigma 暴露 `join_channel` / `read_my_design` / `get_node_info` / `get_nodes_info` / `get_styles` / `get_local_components` / `export_node_as_image` 等 40 个工具——**不要用 Framelink 的 `get_figma_data` 工具名**，两个 MCP 是不同的 server。

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

1. TalkToFigma `read_my_design` 返回截断（节点太多）→ 用 `get_node_info` 分段取关键节点，合并落盘
2. TalkToFigma 拿到的数据缺某个字段 → 兜底调 `get_node_info(nodeId)` 取单个节点完整信息
3. TalkToFigma 整个 server 不可用（bun socket 没跑、Figma 插件没连） → 用 Framelink `get_figma_data`（受 Figma REST 限流，会 429）
4. Figma REST 被限流 + TalkToFigma 也没连 → 告诉用户"两个数据源都不通，需要开启 bun socket + Figma 插件"，落空 ground-truth.json，按 `references/fallback-bitmap-only.md` 走位图兜底

