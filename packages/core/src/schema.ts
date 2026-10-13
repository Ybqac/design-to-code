/**
 * @dtc/core — 数据契约（纯类型定义）
 *
 * 四个核心数据结构：
 *  1. UnifiedNode   统一节点树（TalkToFigma 插件快照 / Figma REST JSON 归一化后的中间形态）
 *  2. GroundTruth   数值锁（design-ground-truth.json，v3：v2 的超集，脚本自动生成，禁止模型手整）
 *  3. DtcSpec       AI 消费用裁剪规格（spec.json，token 化 / 坐标相对化 / 去噪）
 *  4. VerifyReport  验证环产物（report.json：像素 + 结构 + 归因 + 收敛状态）
 *
 * 运行时完整性校验由 dtc check（溯源）与各生成函数的确定性保证，不依赖 schema 校验库。
 * 设计原则：富字段（auto-layout/effects 等）来自增强版插件；旧版插件缺这些字段时
 * 字段为 undefined，下游全部容错——协议向下兼容。
 */

// ---------------------------------------------------------------------------
// 基础构件
// ---------------------------------------------------------------------------

export interface BBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Figma paint（SOLID / GRADIENT_* / IMAGE ...），颜色已转 hex 或 rgba 字符串 */
export interface Paint {
  type: string;
  visible?: boolean;
  opacity?: number;
  color?: string;
  gradientStops?: Array<{ position?: number; color?: string }>;
  scaleMode?: string;
  imageRef?: string;
}

export interface Effect {
  type: string; // DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR
  visible?: boolean;
  color?: string;
  offset?: { x: number; y: number };
  radius?: number;
  spread?: number;
}

/** auto-layout（仅增强版插件返回；旧插件缺省） */
export interface AutoLayout {
  mode: "horizontal" | "vertical" | "none";
  itemSpacing?: number;
  paddingTop?: number;
  paddingRight?: number;
  paddingBottom?: number;
  paddingLeft?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  primaryAxisSizingMode?: string; // FIXED | AUTO
  counterAxisSizingMode?: string;
  layoutWrap?: string;
}

export interface TextStyle {
  fontFamily?: string;
  fontStyle?: string;
  fontWeight?: number;
  fontSize?: number;
  textAlignHorizontal?: string;
  letterSpacing?: number | string;
  lineHeightPx?: number;
}

// ---------------------------------------------------------------------------
// 1. 统一节点树
// ---------------------------------------------------------------------------

export interface UnifiedNode {
  id: string;
  name: string;
  type: string;
  bbox?: BBox; // absoluteBoundingBox；VECTOR 存根可能只有这个
  fills?: Paint[];
  strokes?: Paint[];
  strokeWeight?: number;
  strokeAlign?: string;
  individualStrokeWeights?: Record<string, number>;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  opacity?: number;
  visible?: boolean;
  clipsContent?: boolean;
  effects?: Effect[];
  layout?: AutoLayout;
  characters?: string;
  textStyle?: TextStyle;
  isAsset?: boolean; // 标记：该节点应导出为切图（IMAGE fill / VECTOR / INSTANCE 图形类）
  children: UnifiedNode[];
}

// ---------------------------------------------------------------------------
// 2. GroundTruth v3（v2 超集）
// ---------------------------------------------------------------------------

export type NodeId = string; // 纯数字:数字，如 14669:9900

export interface GtSource {
  via: string; // 如 "dtc-extract talktofigma-ws(channel=dtc)"
  exported_at: string;
  figma_file?: string;
  frame_node_id?: NodeId;
  tool_version?: string;
  plugin_capabilities?: string[]; // ["rich-fields:auto-layout", ...]
}

export interface GtTokens {
  colors: Array<{ name: string; value: string; nodeId: NodeId; path?: string }>;
  typography: Array<{
    name: string;
    fontSize: number;
    fontWeight?: number | string;
    fontFamily?: string;
    lineHeight?: number | string;
    letterSpacing?: number | string;
    nodeId: NodeId;
  }>;
  spacing: Array<{ name: string; value: number; nodeId: NodeId; path?: string }>;
  radius: Array<{ name: string; value: number; nodeId: NodeId; path?: string }>;
}

export type FillRole = "background" | "surface" | "gradient-stop" | "shadow" | "overlay" | "other";
export type StrokeRole = "border" | "outline" | "divider" | "other";
export type NodeRole =
  | "card" | "button" | "input" | "text" | "icon" | "container" | "badge" | "divider"
  | "image" | "nav" | "header" | "footer" | "table-header" | "table-row" | "other";

export interface GtRawStyle {
  nodeId: NodeId;
  name?: string;
  path?: string;
  role: NodeRole;
  fills: Array<{
    color: string;
    role: FillRole;
    opacity?: number;
    gradientStops?: Array<{ position?: number; color: string }>;
  }>;
  strokes: Array<{ color: string; role: StrokeRole; width?: number }>;
  textColor?: string;
  textStyle?: {
    ref?: string;
    fontSize?: number;
    fontWeight?: number | string;
    fontFamily?: string;
    lineHeightPx?: number;
    letterSpacing?: number | string;
  };
  cornerRadius?: number;
  width?: number;
  height?: number;
  bbox?: BBox; // v3：验证环归因要用，v2 没有
  padding?: string;
  paddingPx?: { top: number; right: number; bottom: number; left: number };
  gap?: number;
  layoutMode?: "horizontal" | "vertical" | "none";
  effects?: Effect[]; // v3：阴影等
  opacity?: number;
}

export interface GroundTruth {
  schema_version?: 3;
  source: GtSource;
  tokens?: GtTokens;
  raw_styles: GtRawStyle[];
}

// ---------------------------------------------------------------------------
// 3. DtcSpec（AI 消费用）
// ---------------------------------------------------------------------------

export interface SpecLayoutHint {
  model: "flex-row" | "flex-col" | "grid" | "flow" | "absolute" | "unknown";
  confidence: number; // 0-1
  reason?: string;
  inferred?: true; // [AI 推断] 标记
}

export interface SpecNode {
  id: string;
  name: string;
  role: NodeRole;
  bbox: BBox;
  layout?: AutoLayout; // 来自设计稿 auto-layout（确定性）
  layoutHint?: SpecLayoutHint; // [AI 推断]（无 auto-layout 字段时由几何推断）
  styles?: {
    background?: string;
    gradient?: string; // linear-gradient(...) CSS
    border?: string;
    borderRadius?: number;
    boxShadow?: string;
    opacity?: number;
    padding?: string;
    gap?: number;
  };
  text?: { content: string; style: Record<string, unknown> };
  asset?: string; // assets/ 下相对路径（.dtc/assets/<id>.png|svg）
  children: SpecNode[];
}

export interface DtcSpec {
  version: 1;
  root: SpecNode;
  viewport: { width: number; height: number };
  notes: string[]; // 数据缺口/推断说明，供模型与人工审阅
}

// ---------------------------------------------------------------------------
// 4. VerifyReport
// ---------------------------------------------------------------------------

export interface AttributedNode {
  nodeId: string;
  name?: string;
  type?: string;
  role?: string;
  expected?: Record<string, unknown>; // ground-truth 期望值
  actual?: Record<string, unknown>; // DOM computed style 实际值
}

export interface DiffRegion {
  id: string;
  bbox: BBox;
  diffPixels: number;
  diffRatio?: number; // 区域内差异像素占比
  severity: "high" | "medium" | "low";
  attributedNodes: AttributedNode[];
}

export interface StructureCheck {
  score: number;
  textChecked: number;
  textMatched: number;
  mismatches: Array<{
    kind: "missing-text" | "content" | "fontSize" | "color" | "fontWeight" | "position";
    nodeId?: string;
    expected?: string;
    actual?: string;
    detail?: string;
  }>;
}

export interface VerifyReport {
  version: 1;
  generated_at: string;
  round: number;
  target: {
    url: string;
    viewport: { width: number; height: number };
    fullPage: boolean;
    state: string;
  };
  reference: {
    image: string;
    width: number;
    height: number;
    scaleUsed?: number;
  };
  pixel: {
    score: number; // 0-100
    diffRatio: number; // 0-1
    threshold: number;
    diffImage?: string;
    clusters: number;
  };
  structure?: StructureCheck;
  fidelityScore: number; // 0-100 加权综合
  regions: DiffRegion[];
  convergence: {
    threshold: number;
    converged: boolean;
    previousScore?: number | null;
    stalledRounds: number;
    stop: boolean;
    reason?: string;
  };
  fixPromptPath?: string;
}

// ---------------------------------------------------------------------------
// .dtc/ 规格包 manifest
// ---------------------------------------------------------------------------

export interface DtcManifest {
  version: 1;
  node_id: NodeId;
  node_name?: string;
  figma_file?: string;
  exported_at: string;
  via: string;
  plugin_capabilities: string[];
  viewport: { width: number; height: number };
  ref_scale: number; // 参考图导出倍率
  assets: Array<{ nodeId: string; file: string; kind: string }>;
}
