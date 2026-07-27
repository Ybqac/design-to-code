# Fallback: 纯位图无源文件时的版面识别

## 何时用

只有当**截图是唯一信息源、Figma 源文件和 MCP 都拿不到**时，才启用本文档。正常 fusion 流程不读。

## 主思路

无 ground-truth 时，所有数值失去出处，verify-ground-truth.js 会全部标 `[PENDING]`。此时做两件事提升结构准确性：

1. 用传统版面识别库把截图转成结构化 bbox + 组件类目（辅助布局判断，**不替代视觉模型**）
2. 文字用 OCR 抽出，避免凭空捏造文案

## 推荐工具（按适用度排序）

| 工具 | 输出 | 适合度 | 安装 |
|---|---|---|---|
| **Surya** (github.com/VikParuchuri/surya) | bbox + 17 类版面标签 + 阅读序 + 表格 | 中（文档类目偏多，UI 类目不全） | `pip install surya-ocr` |
| **PP-StructureV3** (PaddleOCR 子项) | bbox + Markdown + JSON + 单元格坐标 | 中（同上，中文场景稳） | `pip install paddlepaddle paddleocr` |
| **OmniParser v2** (microsoft/OmniParser) | 可交互元素 bbox + 图标语义 | 低（出 grounding 不出布局树，但适合识别按钮/输入） | 见仓库 README |

**不要用**：LayoutParser（2021 停滞）、通用 YOLO（需自训组件类目）。

## 加工流程

```bash
# 1. 版面识别（Surya 例）
surya layout input.png --results out/

# 2. OCR（同工具内）
surya ocr input.png --results out/

# 3. 合并产物成结构化输入
# 见下方合并脚本思路
```

合并产物的目标格式：把版面 bbox + OCR 文字拼成与 `fusion-protocol.md` 第 3 步相同格式的结构化布局描述，**注意：这一版的 layout 描述里仍不带精确数值**（数值都待人工核实）。

## 把它接入主流程

走完识别后回到主流程：

1. **取源**：截图（仅此一项）
2. **跳过** ground-truth 导出 → 落空 ground-truth.json
3. **视觉读图**：用本文档的 OCR + 版面识别辅助模型产出结构化布局描述（**OCR 抽到的文字作为截图可见文案的 ground truth**，禁止编造截图外的文案）
4. **fusion 融合**：结构与布局既听截图也听识别产物，二者冲突听截图；所有数值一律标"截图估读"，进 `pending-review.md`
5. **生成代码**：照常按 `framework-*.md`，但所有数值都带 `<!-- 截图估读 -->` 注释
6. **校验**：跑 verify-ground-truth.js 会全部 `[PENDING]`，可接受，但清单要随交付物提交
7. **回环**：headless 渲染与截图 diff，重点纠正结构而非数值

## 边界与坑

- Surya/PP-Structure 把图表、装饰元素当文档版面元素（标题/段落）误判的概率高，**只采纳 bbox 不照单全收类目**
- OCR 对截图里小字、深底白字识别率不稳，**OCR 不是文案 ground truth，截图仍是**——OCR 仅作辅助，模型仍要看截图确认
- OmniParser 出的可点元素 bbox 可作为"哪里是按钮/输入"的参考，**别拿它当布局树**
- 这条路的极限是中等复杂度的页面，密集团件（如网格 9 宫格）误判率高，建议直接和用户确认结构而非硬猜

## 显式不做

- 不假装能恢复精确数值——这条路就是估读，要诚实标注
- 不拿识别库的输出当代码——它只是给模型的辅助输入
- 不跳过 OCR 与截图的双验证——OCR 错了截图会纠
