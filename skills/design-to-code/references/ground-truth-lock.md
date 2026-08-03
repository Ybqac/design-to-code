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

导出后落盘项目根 `design-ground-truth.json`，schema 见 `templates/ground-truth.schema.json`。样例：

```json
{
  "source": {
    "figma_file": "abc123",
    "frame_node_id": "12:345",
    "exported_at": "2026-07-27T10:00:00Z",
    "via": "framelink get_figma_data"
  },
  "tokens": {
    "colors": [
      { "name": "primary", "value": "#3B82F6", "nodeId": "1:2", "path": "Button.fills[0].color" },
      { "name": "text-primary", "value": "#111827", "nodeId": "1:3", "path": "Text.fills[0].color" }
    ],
    "typography": [
      { "name": "h1", "fontSize": 24, "fontWeight": 700, "lineHeight": 32, "nodeId": "2:1" },
      { "name": "body", "fontSize": 14, "fontWeight": 400, "lineHeight": 20, "nodeId": "2:2" }
    ],
    "spacing": [
      { "name": "gap-md", "value": 12, "nodeId": "3:1", "path": "Container.itemSpacing" }
    ],
    "radius": [
      { "name": "card-radius", "value": 8, "nodeId": "1:2", "path": "Button.cornerRadius" }
    ]
  },
  "raw_styles": [
    { "nodeId": "1:2", "type": "BUTTON", "fills": [{"type":"SOLID","color":"#3B82F6"}], "cornerRadius": 8, "itemSpacing": 12 }
  ]
}
```

字段说明：
- `tokens`：人友好的命名 token 列表，按类别分组。`name` 是给代码引用的别名
- `raw_styles`：原始节点样式，给 `verify-ground-truth.js` 做数值反查兜底
- 每条必带 `nodeId`，方便事后回 Figma 定位

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

