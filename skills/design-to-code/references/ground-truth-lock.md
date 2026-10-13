# Ground-Truth v3 — 数值锁（工具自动生成，模型只读）

## 机制变更（v2 → v3）

v2 时代 ground-truth 由模型"按规范手整"，因此需要 INTEGRITY_FAIL 各类防偷懒检查。v3 起 **`dtc extract` 脚本自动生成**，每一步都是确定性函数：

- 输入：TalkToFigma relay 的节点树原始返回（落盘 `raw-node-snapshot.json`，一字不改）
- 输出：`design-ground-truth.json`（tokens 去重汇总 + raw_styles 逐节点角色化）
- 模型**只读不写**：生成代码查值用，无权修改；`dtc check` 的溯源校验依然拿原始快照逐一核对（防人工/模型事后篡改 gt 骗过校验）

## 主次用途

| 角色 | 用途 | 何时用 |
|---|---|---|
| **主用途：生成依据** | 写代码时每个数值（颜色/边框/字号/圆角/阴影/间距/宽高）从这里查 | 生成阶段 |
| **次用途：校验凭证** | `dtc check` 扫代码反查出处；`dtc verify` 归因时取"期望值" | 校验阶段 |

## v3 字段速查

raw_styles 每条（每节点一条，含 VECTOR 存根）：

- `fills[{color, role, opacity, gradientStops}]` — role: background/surface/gradient-stop/…
- `strokes[{color, role, width}]` — role: border/divider/…
- `textColor` + `textStyle{fontSize,fontWeight,fontFamily,lineHeightPx,letterSpacing}`
- `cornerRadius` / `width` / `height` / **`bbox`**（归因坐标映射用）
- `layoutMode` + `gap` + `paddingPx{top,right,bottom,left}`（增强插件才有 auto-layout 字段）
- `effects[]`（阴影/模糊，含转好的 hex 颜色）、`opacity`
- `role` — 语义角色（button/card/input/text/icon/…，供语义化命名）
- `path` — 图层路径（人类可读定位）

## 查值示例

写按钮样式：查 `raw_styles` 里 `nodeId == "14669:1005"`：
- `fills[0].color` → `background: #3b82f6`
- `cornerRadius` → `border-radius: 8px`
- `width/height` → `width: 312px; height: 44px`
代码注释 `/* from 14669:1005 */`。`dtc check` 会核对这个值确实在 gt 里。

## 溯源校验（仍保留，防篡改）

`dtc check <code-dir>` 内置两道：
1. **代码扫描**：硬编码颜色/尺寸逐个反查 gt（含 Tailwind 任意值 `bg-[#xxx]`、CSS、inline style），未命中且无"估读"注释 → UNMATCHED。
2. **溯源校验**：gt 的每个 token 值 / 每个 raw_styles.nodeId 必须能在 `raw-node-snapshot.json` 里找到出处——事后篡改 gt 会被 FORGED 标红。

## 与验证环的联动

`dtc verify` 的归因模块从 gt 取每个差异热区的**期望值**（背景/边框/字号/圆角/尺寸），与 DOM 探针的**实际值**并排写进 fix-prompt——修复时直接对号入座，不需要重新翻文件。
