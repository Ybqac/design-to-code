/**
 * 归一化：TalkToFigma 插件快照 / Figma REST JSON → UnifiedNode 统一节点树。
 *
 * 两源差异：
 *  - 插件（ws 通道）：颜色已是 hex 字符串；增强版插件才有的字段（auto-layout/effects/
 *    strokeWeight/opacity/VECTOR 存根）缺省为 undefined。
 *  - REST：颜色是 0-1 浮点 {r,g,b,a}；layoutMode 是 "NONE"/"HORIZONTAL"/"VERTICAL"；
 *    字段最全，但受限流。
 * 归一化后下游只见 UnifiedNode，不关心来源。
 */
import { UnifiedNode, type Effect, type Paint } from "./schema.js";

// ---------------------------------------------------------------------------
// 颜色工具
// ---------------------------------------------------------------------------

const hx = (v: number) =>
  Math.max(0, Math.min(255, Math.round(v * 255)))
    .toString(16)
    .padStart(2, "0");

/** {r,g,b,a?}（0-1 浮点）→ #RRGGBB 或 #RRGGBBAA（a<1 时） */
export function rgbaFloatToHex(c: { r: number; g: number; b: number; a?: number }): string {
  const base = `#${hx(c.r)}${hx(c.g)}${hx(c.b)}`;
  const a = c.a ?? 1;
  return a < 1 ? `${base}${hx(a)}` : base;
}

// ---------------------------------------------------------------------------
// 通用小工具
// ---------------------------------------------------------------------------

function pick<T extends object, K extends keyof T>(o: T, keys: readonly K[]): Partial<T> {
  const out: Partial<T> = {};
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) out[k] = o[k];
  return out;
}

const LAYOUT_FIELDS = [
  "layoutMode", "itemSpacing", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "primaryAxisAlignItems", "counterAxisAlignItems", "primaryAxisSizingMode",
  "counterAxisSizingMode", "layoutWrap",
] as const;

// ---------------------------------------------------------------------------
// 插件快照归一化
// ---------------------------------------------------------------------------

export interface NormalizeResult {
  root: UnifiedNode;
  capabilities: string[]; // 数据源能力标记：rich-fields / effects / strokes / vector-stub ...
}

function normalizePluginPaint(p: Record<string, unknown>): Paint | undefined {
  if (!p || typeof p !== "object") return undefined;
  const out: Paint = { type: String(p.type ?? "SOLID") };
  if (typeof p.visible === "boolean") out.visible = p.visible;
  if (typeof p.opacity === "number") out.opacity = p.opacity;
  if (typeof p.color === "string") out.color = p.color.toLowerCase();
  if (Array.isArray(p.gradientStops)) {
    out.gradientStops = (p.gradientStops as Record<string, unknown>[]).map((s) => ({
      position: typeof s.position === "number" ? s.position : undefined,
      color: typeof s.color === "string" ? String(s.color).toLowerCase() : undefined,
    }));
  }
  if (typeof p.scaleMode === "string") out.scaleMode = p.scaleMode;
  if (typeof p.imageRef === "string") out.imageRef = p.imageRef;
  return out;
}

function normalizePluginEffects(es: unknown): Effect[] | undefined {
  if (!Array.isArray(es) || es.length === 0) return undefined;
  const out: Effect[] = [];
  for (const e of es as Record<string, unknown>[]) {
    const eff: Effect = { type: String(e.type ?? "DROP_SHADOW") };
    if (typeof e.visible === "boolean") eff.visible = e.visible;
    if (typeof e.color === "string") eff.color = String(e.color).toLowerCase();
    if (e.offset && typeof e.offset === "object") {
      eff.offset = { x: Number((e.offset as any).x) || 0, y: Number((e.offset as any).y) || 0 };
    }
    if (typeof e.radius === "number") eff.radius = e.radius;
    if (typeof e.spread === "number") eff.spread = e.spread;
    out.push(eff);
  }
  return out;
}

function normalizePluginNode(raw: Record<string, unknown>): UnifiedNode {
  const bbox = raw.absoluteBoundingBox as Record<string, number> | undefined;
  const style = raw.style as Record<string, unknown> | undefined;
  const layoutRaw = pick(raw as any, LAYOUT_FIELDS) as Record<string, unknown>;

  const node: UnifiedNode = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    type: String(raw.type ?? ""),
    children: [],
  };
  if (bbox && typeof bbox.x === "number") {
    node.bbox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  }
  if (Array.isArray(raw.fills)) node.fills = raw.fills.map((f) => normalizePluginPaint(f as Record<string, unknown>)).filter(Boolean) as Paint[];
  if (Array.isArray(raw.strokes)) node.strokes = raw.strokes.map((f) => normalizePluginPaint(f as Record<string, unknown>)).filter(Boolean) as Paint[];
  if (typeof raw.strokeWeight === "number") node.strokeWeight = raw.strokeWeight;
  if (typeof raw.cornerRadius === "number") node.cornerRadius = raw.cornerRadius;
  if (typeof raw.opacity === "number") node.opacity = raw.opacity;
  if (typeof raw.visible === "boolean") node.visible = raw.visible;
  if (typeof raw.clipsContent === "boolean") node.clipsContent = raw.clipsContent;
  node.effects = normalizePluginEffects(raw.effects);
  if (raw.layoutMode !== undefined && raw.layoutMode !== null) {
    const lm = String(raw.layoutMode);
    node.layout = {
      mode: lm === "HORIZONTAL" ? "horizontal" : lm === "VERTICAL" ? "vertical" : "none",
      ...(typeof layoutRaw.itemSpacing === "number" ? { itemSpacing: layoutRaw.itemSpacing } : {}),
      ...(typeof layoutRaw.paddingTop === "number" ? { paddingTop: layoutRaw.paddingTop } : {}),
      ...(typeof layoutRaw.paddingRight === "number" ? { paddingRight: layoutRaw.paddingRight } : {}),
      ...(typeof layoutRaw.paddingBottom === "number" ? { paddingBottom: layoutRaw.paddingBottom } : {}),
      ...(typeof layoutRaw.paddingLeft === "number" ? { paddingLeft: layoutRaw.paddingLeft } : {}),
      ...(typeof layoutRaw.primaryAxisAlignItems === "string" ? { primaryAxisAlignItems: layoutRaw.primaryAxisAlignItems } : {}),
      ...(typeof layoutRaw.counterAxisAlignItems === "string" ? { counterAxisAlignItems: layoutRaw.counterAxisAlignItems } : {}),
      ...(typeof layoutRaw.primaryAxisSizingMode === "string" ? { primaryAxisSizingMode: layoutRaw.primaryAxisSizingMode } : {}),
      ...(typeof layoutRaw.counterAxisSizingMode === "string" ? { counterAxisSizingMode: layoutRaw.counterAxisSizingMode } : {}),
      ...(typeof layoutRaw.layoutWrap === "string" ? { layoutWrap: layoutRaw.layoutWrap } : {}),
    };
  }
  if (typeof raw.characters === "string") node.characters = raw.characters;
  if (style) {
    node.textStyle = {
      ...(typeof style.fontFamily === "string" ? { fontFamily: style.fontFamily } : {}),
      ...(typeof style.fontStyle === "string" ? { fontStyle: style.fontStyle } : {}),
      ...(typeof style.fontWeight === "number" ? { fontWeight: style.fontWeight } : {}),
      ...(typeof style.fontSize === "number" ? { fontSize: style.fontSize } : {}),
      ...(typeof style.textAlignHorizontal === "string" ? { textAlignHorizontal: style.textAlignHorizontal } : {}),
      ...(style.letterSpacing !== undefined ? { letterSpacing: style.letterSpacing as number | string } : {}),
      ...(typeof style.lineHeightPx === "number" ? { lineHeightPx: style.lineHeightPx } : {}),
    };
  }
  if (Array.isArray(raw.children)) {
    node.children = (raw.children as Record<string, unknown>[]).map(normalizePluginNode);
  }
  return node;
}

/** 探测快照里实际存在的字段能力（增强版插件 vs 旧版） */
function detectCapabilities(root: UnifiedNode): string[] {
  const caps = new Set<string>();
  const visit = (n: UnifiedNode) => {
    if (n.layout && n.layout.mode !== "none") caps.add("rich-fields:auto-layout");
    if (n.effects?.length) caps.add("rich-fields:effects");
    if (n.strokeWeight !== undefined) caps.add("rich-fields:stroke-weight");
    if (n.opacity !== undefined) caps.add("rich-fields:opacity");
    if (n.type === "VECTOR") caps.add("vector-stub");
    if (n.fills?.some((f) => f.type === "IMAGE")) caps.add("image-fills");
    n.children.forEach(visit);
  };
  visit(root);
  return [...caps];
}

/**
 * TalkToFigma 插件快照 → 统一节点树。
 * 接受 get_node_info 的 result（{document: node} 或 node 本身）、
 * read_my_design 的 result（[{nodeId, document}]，取第一个或指定 index）。
 */
export function normalizeTalkToFigma(raw: unknown): NormalizeResult {
  let doc: Record<string, unknown> | undefined;
  if (Array.isArray(raw)) {
    const first = raw[0] as Record<string, unknown> | undefined;
    doc = (first?.document as Record<string, unknown>) ?? first;
  } else if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    doc = (o.document as Record<string, unknown>) ?? o;
  }
  if (!doc || typeof doc !== "object" || !doc.id) {
    throw new Error("无法识别的插件快照格式：期望 {document: node} 或 [{nodeId, document}]");
  }
  const root = normalizePluginNode(doc);
  return { root, capabilities: detectCapabilities(root) };
}

// ---------------------------------------------------------------------------
// Figma REST JSON 归一化（备用通道）
// ---------------------------------------------------------------------------

function normalizeRestPaint(p: Record<string, unknown>): Paint | undefined {
  const out: Paint = { type: String(p.type ?? "SOLID") };
  if (typeof p.visible === "boolean") out.visible = p.visible;
  if (typeof p.opacity === "number") out.opacity = p.opacity;
  const c = p.color as Record<string, number> | undefined;
  if (c && typeof c.r === "number") out.color = rgbaFloatToHex(c as any);
  if (Array.isArray(p.gradientStops)) {
    out.gradientStops = (p.gradientStops as Record<string, unknown>[]).map((s) => {
      const sc = s.color as Record<string, number> | undefined;
      return {
        position: typeof s.position === "number" ? s.position : undefined,
        color: sc && typeof sc.r === "number" ? rgbaFloatToHex(sc as any) : undefined,
      };
    });
  }
  if (typeof p.scaleMode === "string") out.scaleMode = p.scaleMode;
  if (typeof p.imageRef === "string") out.imageRef = p.imageRef;
  return out;
}

function normalizeRestEffects(es: unknown): Effect[] | undefined {
  if (!Array.isArray(es) || es.length === 0) return undefined;
  return (es as Record<string, unknown>[]).map((e) => {
    const eff: Effect = { type: String(e.type ?? "DROP_SHADOW") };
    if (typeof e.visible === "boolean") eff.visible = e.visible;
    const c = e.color as Record<string, number> | undefined;
    if (c && typeof c.r === "number") eff.color = rgbaFloatToHex(c as any);
    if (e.offset && typeof e.offset === "object") {
      eff.offset = { x: Number((e.offset as any).x) || 0, y: Number((e.offset as any).y) || 0 };
    }
    if (typeof e.radius === "number") eff.radius = e.radius;
    if (typeof e.spread === "number") eff.spread = e.spread;
    return eff;
  });
}

function normalizeRestNode(raw: Record<string, unknown>): UnifiedNode {
  const bbox = raw.absoluteBoundingBox as Record<string, number> | undefined;
  const style = raw.style as Record<string, unknown> | undefined;
  const node: UnifiedNode = {
    id: String(raw.id ?? ""),
    name: String(raw.name ?? ""),
    type: String(raw.type ?? ""),
    children: [],
  };
  if (bbox && typeof bbox.x === "number") {
    node.bbox = { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
  }
  if (Array.isArray(raw.fills) && raw.fills !== null) {
    node.fills = (raw.fills as Record<string, unknown>[]).map(normalizeRestPaint).filter(Boolean) as Paint[];
  }
  if (Array.isArray(raw.strokes)) {
    node.strokes = (raw.strokes as Record<string, unknown>[]).map(normalizeRestPaint).filter(Boolean) as Paint[];
  }
  if (typeof raw.strokeWeight === "number") node.strokeWeight = raw.strokeWeight;
  if (typeof raw.cornerRadius === "number") node.cornerRadius = raw.cornerRadius;
  if (Array.isArray(raw.rectangleCornerRadii)) {
    node.rectangleCornerRadii = (raw.rectangleCornerRadii as number[]).map(Number);
  }
  if (typeof raw.opacity === "number") node.opacity = raw.opacity;
  if (typeof raw.visible === "boolean") node.visible = raw.visible;
  if (typeof raw.clipsContent === "boolean") node.clipsContent = raw.clipsContent;
  node.effects = normalizeRestEffects(raw.effects);
  const lm = raw.layoutMode;
  if (typeof lm === "string" && lm !== "NONE") {
    node.layout = {
      mode: lm === "HORIZONTAL" ? "horizontal" : "vertical",
      ...(typeof raw.itemSpacing === "number" ? { itemSpacing: raw.itemSpacing } : {}),
      ...(typeof raw.paddingTop === "number" ? { paddingTop: raw.paddingTop } : {}),
      ...(typeof raw.paddingRight === "number" ? { paddingRight: raw.paddingRight } : {}),
      ...(typeof raw.paddingBottom === "number" ? { paddingBottom: raw.paddingBottom } : {}),
      ...(typeof raw.paddingLeft === "number" ? { paddingLeft: raw.paddingLeft } : {}),
      ...(typeof raw.primaryAxisAlignItems === "string" ? { primaryAxisAlignItems: raw.primaryAxisAlignItems } : {}),
      ...(typeof raw.counterAxisAlignItems === "string" ? { counterAxisAlignItems: raw.counterAxisAlignItems } : {}),
      ...(typeof raw.primaryAxisSizingMode === "string" ? { primaryAxisSizingMode: raw.primaryAxisSizingMode } : {}),
      ...(typeof raw.counterAxisSizingMode === "string" ? { counterAxisSizingMode: raw.counterAxisSizingMode } : {}),
      ...(typeof raw.layoutWrap === "string" ? { layoutWrap: raw.layoutWrap } : {}),
    };
  }
  if (typeof raw.characters === "string") node.characters = raw.characters;
  if (style) {
    node.textStyle = {
      ...(typeof style.fontFamily === "string" ? { fontFamily: style.fontFamily } : {}),
      ...(typeof style.fontStyle === "string" ? { fontStyle: style.fontStyle } : {}),
      ...(typeof style.fontWeight === "number" ? { fontWeight: style.fontWeight } : {}),
      ...(typeof style.fontSize === "number" ? { fontSize: style.fontSize } : {}),
      ...(typeof style.textAlignHorizontal === "string" ? { textAlignHorizontal: style.textAlignHorizontal } : {}),
      ...(style.letterSpacing !== undefined ? { letterSpacing: style.letterSpacing as number | string } : {}),
      ...(typeof style.lineHeightPx === "number" ? { lineHeightPx: style.lineHeightPx } : {}),
    };
  }
  if (Array.isArray(raw.children)) {
    node.children = (raw.children as Record<string, unknown>[]).map(normalizeRestNode);
  }
  return node;
}

/** Figma REST /v1/files/:key/nodes 的 nodes[id].document → 统一节点树 */
export function normalizeRest(raw: unknown): NormalizeResult {
  let doc: Record<string, unknown> | undefined;
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.nodes && typeof o.nodes === "object") {
      const first = Object.values(o.nodes as Record<string, unknown>)[0] as Record<string, unknown> | undefined;
      doc = (first?.document as Record<string, unknown>) ?? (first as Record<string, unknown>);
    }
    doc = doc ?? (o.document as Record<string, unknown>) ?? o;
  }
  if (!doc || typeof doc !== "object" || !doc.id) {
    throw new Error("无法识别的 REST 快照格式：期望 {nodes: {<id>: {document}}}");
  }
  const root = normalizeRestNode(doc);
  return { root, capabilities: [...detectCapabilities(root), "rest"] };
}

/** 从文件内容自动判别来源并归一化 */
export function normalizeAuto(raw: unknown): NormalizeResult {
  const s = JSON.stringify(raw).slice(0, 200);
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    if (o.nodes) return normalizeRest(raw);
    if (o.document || Array.isArray(raw)) return normalizeTalkToFigma(raw);
  }
  throw new Error(`无法判别快照来源: ${s}`);
}
