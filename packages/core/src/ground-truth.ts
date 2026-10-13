/**
 * ground-truth 生成：UnifiedNode → design-ground-truth.json（v3）。
 *
 * 关键约束（反捏造红线 #4 的机械化）：
 *  - 每个值都直接来自节点树，生成是纯确定性函数，无 AI 参与；
 *  - v2 的 raw_styles 逐节点 + role 标注结构保留，v3 增加 bbox/effects/paddingPx
 *    （验证环归因要用）。
 */
import type { FillRole, GtRawStyle, GroundTruth, NodeRole, StrokeRole, UnifiedNode } from "./schema.js";

export interface GroundTruthOptions {
  via: string;
  exportedAt?: string;
  figmaFile?: string;
  frameNodeId?: string;
  toolVersion?: string;
  pluginCapabilities?: string[];
  /** 跳过过小的节点（默认 2px 以下宽或高的节点仍保留，仅纯装饰丢弃由 isAsset 处理） */
  includeInvisible?: boolean; // 默认 false：visible===false 的跳过
}

// ---------------------------------------------------------------------------
// role 推断（确定性启发式，基于 type + 图层名关键词）
// ---------------------------------------------------------------------------

const ROLE_KEYWORDS: Array<[RegExp, NodeRole]> = [
  [/btn|button|cta/i, "button"],
  [/card|panel|tile/i, "card"],
  [/input|field|search bar|textarea|select/i, "input"],
  [/badge|tag|chip|pill|label$/i, "badge"],
  [/nav|navbar|tab bar|sidebar|menu/i, "nav"],
  [/header|topbar|app bar|title bar/i, "header"],
  [/footer|bottom bar/i, "footer"],
  [/divider|separator|hairline/i, "divider"],
  [/table header|thead/i, "table-header"],
  [/table row|trow|tr$/i, "table-row"],
  [/avatar|logo|img|image|illustration|pic|photo|banner|hero/i, "image"],
  [/icon|ic_|_icon|-icon/i, "icon"],
];

function inferRole(node: UnifiedNode): NodeRole {
  if (node.type === "TEXT") return "text";
  if (node.fills?.some((f) => f.type === "IMAGE")) return "image";
  if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "ELLIPSE" || node.type === "STAR" || node.type === "LINE") {
    return node.type === "LINE" ? "divider" : "icon";
  }
  for (const [re, role] of ROLE_KEYWORDS) {
    if (re.test(node.name)) return role;
  }
  if (node.type === "INSTANCE" || node.type === "COMPONENT") return "other";
  if (node.children.length > 0) return "container";
  return "other";
}

// ---------------------------------------------------------------------------
// fills/strokes → 角色化
// ---------------------------------------------------------------------------

function visibleFills(node: UnifiedNode) {
  return (node.fills ?? []).filter((f) => f.visible !== false && (f.type !== "SOLID" || f.color));
}

function roleFills(role: NodeRole): FillRole {
  if (role === "card" || role === "badge" || role === "table-header") return "surface";
  return "background";
}

function normalizeRawStylesFor(node: UnifiedNode, role: NodeRole): GtRawStyle {
  const entry: GtRawStyle = {
    nodeId: node.id,
    name: node.name,
    role,
    fills: [],
    strokes: [],
  };

  for (const f of visibleFills(node)) {
    if (f.type === "SOLID" && f.color) {
      entry.fills.push({
        color: f.color,
        role: roleFills(role),
        opacity: f.opacity,
      });
    } else if (f.type.startsWith("GRADIENT") && f.gradientStops) {
      for (const s of f.gradientStops) {
        if (s.color) entry.fills.push({ color: s.color, role: "gradient-stop" });
      }
    } else if (f.type === "IMAGE") {
      entry.fills.push({ color: "image", role: "other" });
    }
  }

  for (const s of node.strokes ?? []) {
    if (s.visible === false || !s.color) continue;
    entry.strokes.push({
      color: s.color,
      role: role === "divider" ? "divider" : "border",
      width: node.strokeWeight,
    });
  }

  if (node.type === "TEXT") {
    const solid = visibleFills(node).find((f) => f.type === "SOLID" && f.color);
    if (solid?.color) entry.textColor = solid.color;
    if (node.textStyle) entry.textStyle = { ...node.textStyle };
  }

  if (node.cornerRadius !== undefined && node.cornerRadius > 0) entry.cornerRadius = node.cornerRadius;
  if (node.bbox) {
    entry.width = node.bbox.width;
    entry.height = node.bbox.height;
    entry.bbox = node.bbox;
  }
  if (node.layout) {
    entry.layoutMode = node.layout.mode;
    if (node.layout.itemSpacing !== undefined) entry.gap = node.layout.itemSpacing;
    const { paddingTop: t, paddingRight: r, paddingBottom: b, paddingLeft: l } = node.layout;
    if ([t, r, b, l].some((v) => v !== undefined)) {
      entry.paddingPx = { top: t ?? 0, right: r ?? 0, bottom: b ?? 0, left: l ?? 0 };
      entry.padding = `${t ?? 0}px ${r ?? 0}px ${b ?? 0}px ${l ?? 0}px`;
    }
  }
  if (node.effects?.length) entry.effects = node.effects;
  if (node.opacity !== undefined && node.opacity !== 1) entry.opacity = node.opacity;

  return entry;
}

// ---------------------------------------------------------------------------
// tokens 汇总（去重，按值聚合）
// ---------------------------------------------------------------------------

function collectTokens(root: UnifiedNode) {
  const colorMap = new Map<string, { name: string; value: string; nodeId: string; path: string }>();
  const typoMap = new Map<string, { name: string; fontSize: number; fontWeight?: number | string; fontFamily?: string; lineHeight?: number | string; letterSpacing?: number | string; nodeId: string }>();
  const spacingSet = new Map<number, { name: string; value: number; nodeId: string; path: string }>();
  const radiusSet = new Map<number, { name: string; value: number; nodeId: string; path: string }>();

  let colorIdx = 0;
  let typoIdx = 0;
  let path: string[] = [];

  const addColor = (value: string, node: UnifiedNode) => {
    const key = value.toLowerCase();
    if (!colorMap.has(key)) {
      colorIdx += 1;
      colorMap.set(key, {
        name: `color-${colorIdx}`,
        value: key,
        nodeId: node.id,
        path: path.join("/"),
      });
    }
  };

  const visit = (node: UnifiedNode) => {
    const prevPath = path;
    path = [...path, node.name];

    if (node.visible !== false) {
      for (const f of visibleFills(node)) {
        if (f.type === "SOLID" && f.color) addColor(f.color, node);
        if (f.gradientStops) for (const s of f.gradientStops) if (s.color) addColor(s.color, node);
      }
      for (const s of node.strokes ?? []) {
        if (s.visible !== false && s.color) addColor(s.color, node);
      }
      if (node.type === "TEXT" && node.textStyle?.fontSize !== undefined) {
        const ts = node.textStyle;
        const key = `${ts.fontFamily ?? ""}|${node.textStyle.fontSize}|${ts.fontWeight ?? ""}|${ts.lineHeightPx ?? ""}`;
        if (!typoMap.has(key)) {
          typoIdx += 1;
          typoMap.set(key, {
            name: `text-${typoIdx}`,
            fontSize: node.textStyle.fontSize,
            fontWeight: ts.fontWeight,
            fontFamily: ts.fontFamily,
            lineHeight: ts.lineHeightPx,
            letterSpacing: ts.letterSpacing,
            nodeId: node.id,
          });
        }
      }
      if (node.layout?.itemSpacing !== undefined && !spacingSet.has(node.layout.itemSpacing)) {
        spacingSet.set(node.layout.itemSpacing, {
          name: `spacing-${node.layout.itemSpacing}`,
          value: node.layout.itemSpacing,
          nodeId: node.id,
          path: path.join("/"),
        });
      }
      if (node.cornerRadius !== undefined && node.cornerRadius > 0 && !radiusSet.has(node.cornerRadius)) {
        radiusSet.set(node.cornerRadius, {
          name: `radius-${node.cornerRadius}`,
          value: node.cornerRadius,
          nodeId: node.id,
          path: path.join("/"),
        });
      }
    }

    node.children.forEach(visit);
    path = prevPath;
  };

  visit(root);
  return {
    colors: [...colorMap.values()],
    typography: [...typoMap.values()],
    spacing: [...spacingSet.values()],
    radius: [...radiusSet.values()],
  };
}

// ---------------------------------------------------------------------------
// 主入口
// ---------------------------------------------------------------------------

export function buildGroundTruth(root: UnifiedNode, opts: GroundTruthOptions): GroundTruth {
  const rawStyles: GtRawStyle[] = [];
  let path: string[] = [];

  const visit = (node: UnifiedNode) => {
    const prevPath = path;
    path = [...path, node.name];
    if (opts.includeInvisible || node.visible !== false) {
      const entry = normalizeRawStylesFor(node, inferRole(node));
      entry.path = path.join("/");
      rawStyles.push(entry);
    }
    node.children.forEach(visit);
    path = prevPath;
  };
  visit(root);

  const tokens = collectTokens(root);

  return {
    schema_version: 3,
    source: {
      via: opts.via,
      exported_at: opts.exportedAt ?? new Date().toISOString(),
      figma_file: opts.figmaFile,
      frame_node_id: opts.frameNodeId ?? root.id,
      tool_version: opts.toolVersion,
      plugin_capabilities: opts.pluginCapabilities,
    },
    tokens,
    raw_styles: rawStyles,
  };
}
