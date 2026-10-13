/**
 * 归因：diff 热区（视口坐标）→ Figma nodeId + 期望值/实际值。
 *
 * 这是本工具链的差异化核心：pixelmatch 只给像素差异，我们把每个热区映射回
 * 设计节点（bbox 交集排序），再从 ground-truth 取期望值、从 DOM 探针取实际值，
 * 让 fix-prompt 能说"节点 14669:9900（Submit Button）期望背景 #3B82F6，实际渲染 #60A5FA"。
 *
 * 坐标对齐约定：verify 在 diff 前已把两张图缩放到同尺寸（对齐图）。
 * 对齐图坐标 → Figma 坐标：figmaX = alignX / alignScale + rootOffset.x。
 */
import type { AttributedNode, BBox, DiffRegion, GroundTruth, UnifiedNode } from "./schema.js";

export interface AlignTransform {
  /** 对齐图像素 → Figma px 的比例（如参考图 2x 导出且未缩放，则为 0.5） */
  scale: number;
  /** Figma 画布偏移（根节点 bbox 的 x/y） */
  offsetX: number;
  offsetY: number;
}

export interface DomProbe {
  /** DOM 侧采到的实际样式（由 cli/verify 用 Playwright evaluate 采集） */
  tag?: string;
  text?: string;
  background?: string;
  color?: string;
  fontSize?: string;
  fontWeight?: string;
  borderRadius?: string;
  boxShadow?: string;
  size?: { width: number; height: number };
  snippet?: string;
}

function intersect(a: BBox, b: BBox): number {
  const ix = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const iy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ix * iy;
}

/** 把对齐图坐标的 region bbox 转成 Figma 坐标 */
export function regionToFigma(bbox: BBox, t: AlignTransform): BBox {
  return {
    x: bbox.x * t.scale + t.offsetX,
    y: bbox.y * t.scale + t.offsetY,
    width: bbox.width * t.scale,
    height: bbox.height * t.scale,
  };
}

/**
 * 找与热区最相关的节点：交集面积占比排序，浅层优先（容器交集大但修正要落到
 * 具体元素），每个 region 最多 maxNodes 个。
 */
export function attributeRegion(
  regionBBox: BBox, // 已转 Figma 坐标
  root: UnifiedNode,
  gt: GroundTruth | undefined,
  probes: Map<string, DomProbe>, // nodeId → DOM 实际值
  maxNodes = 3,
): AttributedNode[] {
  const hits: Array<{ node: UnifiedNode; overlap: number; depth: number; nodeRatio: number }> = [];

  const visit = (node: UnifiedNode, depth: number) => {
    if (node.visible === false || !node.bbox) {
      node.children.forEach((c) => visit(c, depth + 1));
      return;
    }
    const ov = intersect(regionBBox, node.bbox);
    if (ov > 0) {
      const nodeArea = Math.max(node.bbox.width * node.bbox.height, 1);
      const regionArea = Math.max(regionBBox.width * regionBBox.height, 1);
      hits.push({ node, overlap: ov, depth, nodeRatio: ov / nodeArea });
      // region 完全包含的小节点是最精确的命中
      void regionArea;
    }
    node.children.forEach((c) => visit(c, depth + 1));
  };
  visit(root, 0);

  // 评分：交集面积（region 视角）为主，浅层惩罚小、被 region 完整包含的加分
  const regionArea = Math.max(regionBBox.width * regionBBox.height, 1);
  hits.sort((a, b) => {
    const sa = a.overlap / regionArea + a.nodeRatio * 0.4 - a.depth * 0.01;
    const sb = b.overlap / regionArea + b.nodeRatio * 0.4 - b.depth * 0.01;
    return sb - sa;
  });

  const out: AttributedNode[] = [];
  for (const h of hits.slice(0, maxNodes)) {
    const raw = gt?.raw_styles.find((s) => s.nodeId === h.node.id);
    const probe = probes.get(h.node.id);
    const expected: Record<string, unknown> = {};
    const actual: Record<string, unknown> = {};
    if (raw) {
      const bg = raw.fills.find((f) => f.role === "background" || f.role === "surface");
      if (bg) expected.background = bg.color;
      const border = raw.strokes.find((s) => s.role === "border");
      if (border) expected.border = border.width ? `${border.width}px ${border.color}` : border.color;
      if (raw.textColor) expected.textColor = raw.textColor;
      if (raw.textStyle?.fontSize) expected.fontSize = `${raw.textStyle.fontSize}px`;
      if (raw.cornerRadius) expected.borderRadius = `${raw.cornerRadius}px`;
      if (raw.width) expected.size = `${Math.round(raw.width)}x${Math.round(raw.height ?? 0)}`;
    }
    if (probe) {
      if (probe.background) actual.background = probe.background;
      if (probe.color) actual.textColor = probe.color;
      if (probe.fontSize) actual.fontSize = probe.fontSize;
      if (probe.borderRadius) actual.borderRadius = probe.borderRadius;
      if (probe.size) actual.size = `${Math.round(probe.size.width)}x${Math.round(probe.size.height)}`;
      if (probe.text !== undefined) actual.text = probe.text.slice(0, 40);
    }
    out.push({
      nodeId: h.node.id,
      name: h.node.name,
      type: h.node.type,
      role: raw?.role,
      expected: Object.keys(expected).length ? expected : undefined,
      actual: Object.keys(actual).length ? actual : undefined,
    });
  }
  return out;
}

/** 批量归因（原地填充 regions[].attributedNodes） */
export function attributeRegions(
  regions: DiffRegion[],
  root: UnifiedNode,
  transform: AlignTransform,
  gt: GroundTruth | undefined,
  probes: Map<string, DomProbe>,
): DiffRegion[] {
  for (const r of regions) {
    const figmaBox = regionToFigma(r.bbox, transform);
    r.attributedNodes = attributeRegion(figmaBox, root, gt, probes);
  }
  return regions;
}

/** 找包含某点（Figma 坐标）的最小可见节点（DOM 探针 → nodeId 映射用） */
export function findNodeAtPoint(root: UnifiedNode, x: number, y: number): UnifiedNode | undefined {
  let best: UnifiedNode | undefined;
  let bestArea = Infinity;
  const visit = (node: UnifiedNode) => {
    const b = node.bbox;
    if (node.visible !== false && b && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      const area = b.width * b.height;
      if (area < bestArea) {
        bestArea = area;
        best = node;
      }
    }
    node.children.forEach(visit);
  };
  visit(root);
  return best;
}
