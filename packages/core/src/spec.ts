/**
 * spec 生成：UnifiedNode → DtcSpec（AI 消费用的裁剪规格）。
 *
 * 原则：
 *  - 数值全部来自节点树（确定性）；布局模型优先 auto-layout，缺省才用几何推断并标 [AI 推断]；
 *  - 不可见子树剪掉；纯结构容器不带样式键；文本节点带 characters + textStyle；
 *  - isAsset 节点（IMAGE fill / VECTOR / INSTANCE 图形类）挂 asset 路径，禁止模型造替代品；
 *  - notes 记录数据缺口，供人工审阅（4a 闸口）与模型自知。
 */
import { hasAutoLayout, inferLayoutHint } from "./layout-infer.js";
import type { DtcSpec, SpecNode, UnifiedNode } from "./schema.js";

function solidToCss(f: { color?: string; opacity?: number }): string | undefined {
  if (!f.color) return undefined;
  if (f.opacity !== undefined && f.opacity < 1) {
    // hex #RRGGBB → rgba
    const h = f.color.replace("#", "");
    if (h.length >= 6) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      return `rgba(${r}, ${g}, ${b}, ${f.opacity})`;
    }
  }
  return f.color;
}

function gradientToCss(stops: Array<{ position?: number; color?: string }>): string | undefined {
  if (!stops.length) return undefined;
  const parts = stops
    .filter((s) => s.color)
    .map((s) => `${s.color} ${Math.round((s.position ?? 0) * 100)}%`);
  return parts.length ? `linear-gradient(to right, ${parts.join(", ")})` : undefined;
}

function effectToBoxShadow(effects: NonNullable<UnifiedNode["effects"]>): string | undefined {
  const shadows = effects
    .filter((e) => (e.type === "DROP_SHADOW" || e.type === "INNER_SHADOW") && e.visible !== false)
    .map((e) => {
      const off = e.offset ?? { x: 0, y: 0 };
      const color = e.color ?? "rgba(0,0,0,0.15)";
      const inset = e.type === "INNER_SHADOW" ? "inset " : "";
      return `${inset}${off.x}px ${off.y}px ${e.radius ?? 0}px ${e.spread ?? 0}px ${color}`;
    });
  return shadows.length ? shadows.join(", ") : undefined;
}

export interface SpecOptions {
  viewport: { width: number; height: number };
  /** 资产映射：nodeId → assets/ 相对路径 */
  assetMap?: Map<string, string>;
}

/** 标记应导出为切图的节点（反捏造红线 #1 的正解入口） */
export function isAssetNode(node: UnifiedNode): boolean {
  if (node.fills?.some((f) => f.type === "IMAGE" && f.visible !== false)) return true;
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") return true;
  // 无子节点且无文本的 INSTANCE（组件图标/logo 类）默认切图
  if (node.type === "INSTANCE" && node.children.length === 0) return true;
  return false;
}

export function buildSpec(root: UnifiedNode, opts: SpecOptions): DtcSpec {
  const notes: string[] = [];
  let inferredCount = 0;
  let missingLayoutCount = 0;
  let assetCount = 0;

  const convert = (node: UnifiedNode, depth: number): SpecNode | undefined => {
    if (node.visible === false) return undefined;
    // VECTOR 在增强插件里是存根；不进 spec（走 asset）
    if (node.type === "VECTOR" && !node.children.length) {
      return node.bbox
        ? { id: node.id, name: node.name, role: "icon", bbox: node.bbox, children: [], asset: opts.assetMap?.get(node.id) ?? `<缺失资产 ${node.id}>` }
        : undefined;
    }

    const specNode: SpecNode = {
      id: node.id,
      name: node.name,
      role: inferSpecRole(node),
      bbox: node.bbox ?? { x: 0, y: 0, width: 0, height: 0 },
      children: [],
    };

    if (node.layout) specNode.layout = node.layout;
    if (!hasAutoLayout(node) && node.children.length >= 2 && depth < 24) {
      const hint = inferLayoutHint(node);
      if (hint) {
        specNode.layoutHint = hint;
        missingLayoutCount += 1;
        if (hint.model !== "unknown") inferredCount += 1;
      }
    }

    // 样式（有才带键）
    const styles: NonNullable<SpecNode["styles"]> = {};
    const fills = (node.fills ?? []).filter((f) => f.visible !== false);
    const solid = fills.find((f) => f.type === "SOLID");
    const grad = fills.find((f) => (f.type ?? "").startsWith("GRADIENT"));
    const bg = solidToCss(solid ?? {});
    if (bg) styles.background = bg;
    const gg = grad?.gradientStops ? gradientToCss(grad.gradientStops) : undefined;
    if (gg) styles.gradient = gg;
    const stroke = (node.strokes ?? []).find((s) => s.visible !== false && s.color);
    if (stroke?.color) {
      styles.border = `${node.strokeWeight ?? 1}px solid ${stroke.color}`;
    }
    if (node.cornerRadius !== undefined && node.cornerRadius > 0) styles.borderRadius = node.cornerRadius;
    const shadow = node.effects ? effectToBoxShadow(node.effects) : undefined;
    if (shadow) styles.boxShadow = shadow;
    if (node.opacity !== undefined && node.opacity < 1) styles.opacity = node.opacity;
    if (node.layout) {
      const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = node.layout;
      if ([t, r, b, l].some((v) => v !== undefined && v > 0)) {
        styles.padding = `${t ?? 0}px ${r ?? 0}px ${b ?? 0}px ${l ?? 0}px`;
      }
      if (node.layout.itemSpacing !== undefined) styles.gap = node.layout.itemSpacing;
    }
    if (Object.keys(styles).length > 0) specNode.styles = styles;

    if (node.type === "TEXT" && node.characters !== undefined) {
      const ts: Record<string, unknown> = { ...node.textStyle };
      const solidText = fills.find((f) => f.type === "SOLID" && f.color);
      if (solidText?.color) ts.color = solidText.color;
      specNode.text = { content: node.characters, style: ts };
    }

    if (isAssetNode(node)) {
      assetCount += 1;
      specNode.asset = opts.assetMap?.get(node.id) ?? `<缺失资产 ${node.id}>`;
    }

    specNode.children = node.children
      .map((c) => convert(c, depth + 1))
      .filter((c): c is SpecNode => c !== undefined);

    return specNode;
  };

  const specRoot = convert(root, 0);
  if (!specRoot) throw new Error("根节点不可见，无法生成 spec");

  if (missingLayoutCount > 0) {
    notes.push(
      `[AI 推断] ${missingLayoutCount} 个容器无 auto-layout 字段（旧版插件或设计未规范使用），其中 ${inferredCount} 个由几何关系推断出 flex/grid/absolute，其余标 unknown——请以参考图视觉判断为准`,
    );
  }
  if (assetCount > 0) notes.push(`检测到 ${assetCount} 个切图节点，素材应使用 .dtc/assets/ 下真实文件，禁止占位图/通用 SVG 替代`);
  notes.push("spec 中所有颜色/字号/圆角/间距数值均为 Figma 确定值；生成代码时数值以 .dtc/design-ground-truth.json 为准");

  return {
    version: 1,
    root: specRoot,
    viewport: opts.viewport,
    notes,
  };
}

function inferSpecRole(node: UnifiedNode): SpecNode["role"] {
  if (node.type === "TEXT") return "text";
  if (node.fills?.some((f) => f.type === "IMAGE")) return "image";
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION") return "icon";
  return node.children.length > 0 ? "container" : "other";
}
