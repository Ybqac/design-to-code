/**
 * 差异像素 → 热区聚类。
 *
 * pixelmatch 只告诉我们哪些像素不同；要指导修正必须知道"哪里"成块不同。
 * 实现：网格降采样（cell=16px）→ 细胞激活图 → 连通域合并 → 输出 DiffRegion[]。
 * 复杂度 O(w*h + cells)，避免全分辨率连通域的内存/递归问题。
 */
import type { BBox, DiffRegion } from "./schema.js";

export interface ClusterOptions {
  /** 降采样网格边长（对齐后图像像素），默认 16 */
  cellSize?: number;
  /** 区域内差异像素占区域面积比例 ≥ 该值才算 high，默认 0.25 */
  highSeverity?: number;
  /** ≥ 该值为 medium，默认 0.08 */
  mediumSeverity?: number;
  /** 过滤过小区域（面积 px²），默认 400（20x20） */
  minArea?: number;
}

interface Cell {
  cx: number;
  cy: number;
  count: number;
}

/**
 * @param width/@param height 对齐后图像尺寸
 * @param isDiff 像素级判定函数（i = (y * width + x) * 4 之类的索引由调用方管理，
 *               这里按 x,y 逐像素回调；内部只对每 cell 抽样 count）
 */
export function clusterDiffPixels(
  width: number,
  height: number,
  isDiff: (x: number, y: number) => boolean,
  opts: ClusterOptions = {},
): DiffRegion[] {
  const cell = opts.cellSize ?? 16;
  const minArea = opts.minArea ?? 400;
  const high = opts.highSeverity ?? 0.25;
  const medium = opts.mediumSeverity ?? 0.08;

  const cols = Math.ceil(width / cell);
  const rows = Math.ceil(height / cell);
  const counts = new Uint32Array(cols * rows);
  let totalDiff = 0;

  // 逐像素标记（跳步采样加速：大图每 2px 采样一次，计数放大补偿）
  const step = width * height > 4_000_000 ? 2 : 1;
  const stepArea = step * step;
  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      if (isDiff(x, y)) {
        counts[Math.floor(y / cell) * cols + Math.floor(x / cell)] += stepArea;
        totalDiff += stepArea;
      }
    }
  }
  if (totalDiff === 0) return [];

  // 激活细胞（count > 0 即算，后续按面积过滤）
  const active: Cell[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const c = counts[cy * cols + cx];
      if (c > 0) active.push({ cx, cy, count: c });
    }
  }

  // BFS 连通域（8 邻接）
  const key = (c: Cell) => c.cy * cols + c.cx;
  const activeSet = new Map<number, Cell>(active.map((c) => [key(c), c]));
  const visited = new Set<number>();
  const regions: DiffRegion[] = [];
  let regionIdx = 0;

  for (const start of active) {
    if (visited.has(key(start))) continue;
    const queue = [start];
    visited.add(key(start));
    const component: Cell[] = [];
    let diffPixels = 0;
    while (queue.length) {
      const c = queue.pop() as Cell;
      component.push(c);
      diffPixels += c.count;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nk = (c.cy + dy) * cols + (c.cx + dx);
          const n = activeSet.get(nk);
          if (n && !visited.has(nk)) {
            visited.add(nk);
            queue.push(n);
          }
        }
      }
    }

    // 组件 bbox（像素坐标）
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const c of component) {
      minX = Math.min(minX, c.cx * cell);
      minY = Math.min(minY, c.cy * cell);
      maxX = Math.max(maxX, (c.cx + 1) * cell);
      maxY = Math.max(maxY, (c.cy + 1) * cell);
    }
    const bbox: BBox = {
      x: Math.max(0, minX),
      y: Math.max(0, minY),
      width: Math.min(width, maxX) - Math.max(0, minX),
      height: Math.min(height, maxY) - Math.max(0, minY),
    };
    const area = bbox.width * bbox.height;
    if (area < minArea && diffPixels < minArea / 4) continue; // 噪点

    const ratio = area > 0 ? diffPixels / area : 0;
    regionIdx += 1;
    regions.push({
      id: `r${regionIdx}`,
      bbox,
      diffPixels,
      diffRatio: Math.min(1, ratio),
      severity: ratio >= high ? "high" : ratio >= medium ? "medium" : "low",
      attributedNodes: [],
    });
  }

  // 按 diffPixels 降序
  regions.sort((a, b) => b.diffPixels - a.diffPixels);
  return regions.map((r, i) => ({ ...r, id: `r${i + 1}` }));
}
