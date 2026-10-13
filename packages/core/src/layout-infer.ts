/**
 * 布局语义推断：无 auto-layout 字段时，从子节点几何关系推断 flex/grid/flow/absolute。
 *
 * 全部输出带 inferred: true（[AI 推断] 标记）与置信度——auto-layout 字段存在时
 * 永远优先用确定性数据，不进本模块。
 */
import type { SpecLayoutHint, UnifiedNode } from "./schema.js";

interface ChildBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function boxes(children: UnifiedNode[]): { node: UnifiedNode; box: ChildBox }[] {
  return children
    .filter((c) => c.visible !== false && c.bbox)
    .map((c) => ({ node: c, box: c.bbox as ChildBox }));
}

/** 两个 y 区间的重叠比例（相对较矮者） */
function yOverlap(a: ChildBox, b: ChildBox): number {
  const overlap = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return overlap / Math.min(a.height, b.height, 1);
}

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function uniformity(values: number[]): number {
  if (values.length < 2) return 1;
  const m = median(values);
  if (m === 0) return 1;
  const maxDev = Math.max(...values.map((v) => Math.abs(v - m) / Math.abs(m)));
  return Math.max(0, 1 - maxDev);
}

/**
 * 推断单个容器子的布局模型。
 * 规则（保守，宁缺毋滥）：
 *  - 子节点两两 y 重叠 ≥0.6 且 x 递增 → flex-row
 *  - x 区间大量重叠且 y 递增 → flex-col
 *  - 行列都成组且间距规整 → grid
 *  - 子节点显著互相重叠（非流） → absolute
 *  - 其他 → unknown（交给模型按截图判断）
 */
export function inferLayoutHint(container: UnifiedNode): SpecLayoutHint | undefined {
  const children = boxes(container.children);
  if (children.length < 2) return undefined;

  const sortedX = [...children].sort((a, b) => a.box.x - b.box.x);
  const sortedY = [...children].sort((a, b) => a.box.y - b.box.y);

  // 行检测：按 x 排序后相邻两两 y 重叠
  let rowPairs = 0;
  for (let i = 1; i < sortedX.length; i++) {
    if (yOverlap(sortedX[i - 1].box, sortedX[i].box) >= 0.6) rowPairs++;
  }
  const rowRatio = rowPairs / (children.length - 1);

  // 列检测：按 y 排序后相邻 x 区间重叠
  let colPairs = 0;
  for (let i = 1; i < sortedY.length; i++) {
    const a = sortedY[i - 1].box;
    const b = sortedY[i].box;
    const overlap = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
    const minW = Math.max(Math.min(a.width, b.width), 1);
    if (overlap / minW >= 0.6) colPairs++;
  }
  const colRatio = colPairs / (children.length - 1);

  // 间距规整度
  const gapsX: number[] = [];
  for (let i = 1; i < sortedX.length; i++) {
    gapsX.push(sortedX[i].box.x - (sortedX[i - 1].box.x + sortedX[i - 1].box.width));
  }
  const gapsY: number[] = [];
  for (let i = 1; i < sortedY.length; i++) {
    gapsY.push(sortedY[i].box.y - (sortedY[i - 1].box.y + sortedY[i - 1].box.height));
  }

  // 互相重叠检测（相邻且面积交叠超 30%）
  let overlapped = 0;
  for (let i = 0; i < children.length; i++) {
    for (let j = i + 1; j < children.length; j++) {
      const a = children[i].box;
      const b = children[j].box;
      const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
      const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
      const inter = ix * iy;
      const minArea = Math.min(a.width * a.height, b.width * b.height);
      if (minArea > 0 && inter / minArea > 0.3) overlapped++;
    }
  }
  const pairCount = (children.length * (children.length - 1)) / 2;
  if (overlappedThreshold(overlapped, pairCount)) {
    return { model: "absolute", confidence: 0.7, reason: `${overlapped}/${pairCount} 对子节点显著重叠`, inferred: true };
  }

  if (rowRatio >= 0.7) {
    const gapU = uniformity(gapsX.filter((g) => g >= 0));
    const confidence = Math.min(0.95, 0.55 + 0.2 * rowRatio + 0.2 * gapU);
    const gap = gapsX.length ? median(gapsX.filter((g) => g >= 0)) : 0;
    return {
      model: "flex-row",
      confidence,
      reason: `子节点水平排列（y 对齐率 ${(rowRatio * 100) | 0}%）${gapU > 0.85 ? `，间距规整（~${Math.round(gap)}px）` : ""}`,
      inferred: true,
    };
  }
  if (colRatio >= 0.7) {
    const gapU = uniformity(gapsY.filter((g) => g >= 0));
    const confidence = Math.min(0.95, 0.55 + 0.2 * colRatio + 0.2 * gapU);
    const gap = gapsY.length ? median(gapsY.filter((g) => g >= 0)) : 0;
    return {
      model: "flex-col",
      confidence,
      reason: `子节点垂直排列（x 对齐率 ${(colRatio * 100) | 0}%）${gapU > 0.85 ? `，间距规整（~${Math.round(gap)}px）` : ""}`,
      inferred: true,
    };
  }

  // 行列都存在分组迹象 → grid
  if (rowRatio >= 0.4 && colRatio >= 0.4) {
    return { model: "grid", confidence: 0.6, reason: "行列均呈规整分组", inferred: true };
  }

  return { model: "unknown", confidence: 0.3, reason: "几何关系不规整，请以截图视觉判断为准", inferred: true };
}

function overlappedThreshold(overlapped: number, pairCount: number): boolean {
  return pairCount > 0 && overlapped > 0 && overlapped / pairCount >= 0.3;
}

/** 容器是否有确定性 auto-layout（有则无需推断） */
export function hasAutoLayout(node: UnifiedNode): boolean {
  return node.layout !== undefined && node.layout.mode !== "none";
}
