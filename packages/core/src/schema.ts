/**
 * @dtc/core — 数据契约。
 *
 * 我们自己落盘的产物用 zod 描述，类型一律 z.infer，避免接口和校验各写一份：
 *  1. UnifiedNode   统一节点树（插件快照 / Figma REST JSON 归一化后）
 *  2. GroundTruth   数值锁（design-ground-truth.json）
 *  3. DtcSpec       AI 消费用裁剪规格（spec.json）
 *  4. VerifyReport  验证环产物（report.json）
 *  5. DtcManifest   .dtc/manifest.json
 *
 * 原始 Figma 快照（插件 ws 通道和 REST）不走这套严格 schema，见 RawFigmaSnapshotSchema。
 * 富字段（auto-layout / effects 等）来自增强版插件；旧版缺这些字段时为 undefined，下游容错。
 */
import { z } from "zod";

const numOrString = z.union([z.number(), z.string()], {
  errorMap: () => ({ message: "应为 number 或 string" }),
});

function formatIssues(error: z.ZodError): string {
  const shown = error.issues.slice(0, 12);
  const parts = shown.map((issue) => {
    const field = issue.path.length === 0 ? "(root)" : issue.path.map(String).join(".");
    return `${field}: ${issue.message}`;
  });
  if (error.issues.length > shown.length) {
    parts.push(`还有 ${error.issues.length - shown.length} 处`);
  }
  return parts.join("; ");
}

function parseWith<T>(schema: z.ZodType<T>, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new Error(`${label} 校验失败: ${formatIssues(result.error)}`);
  }
  return result.data;
}

// ---------------------------------------------------------------------------
// 基础构件
// ---------------------------------------------------------------------------

export const BBoxSchema = z.object({
  x: z.number(),
  y: z.number(),
  width: z.number(),
  height: z.number(),
});
export type BBox = z.infer<typeof BBoxSchema>;

/** Figma paint（SOLID / GRADIENT_* / IMAGE ...），颜色已转 hex 或 rgba 字符串 */
export const PaintSchema = z.object({
  type: z.string(),
  visible: z.boolean().optional(),
  opacity: z.number().optional(),
  color: z.string().optional(),
  gradientStops: z.array(z.object({
    position: z.number().optional(),
    color: z.string().optional(),
  })).optional(),
  scaleMode: z.string().optional(),
  imageRef: z.string().optional(),
});
export type Paint = z.infer<typeof PaintSchema>;

export const EffectSchema = z.object({
  type: z.string(), // DROP_SHADOW / INNER_SHADOW / LAYER_BLUR / BACKGROUND_BLUR
  visible: z.boolean().optional(),
  color: z.string().optional(),
  offset: z.object({ x: z.number(), y: z.number() }).optional(),
  radius: z.number().optional(),
  spread: z.number().optional(),
});
export type Effect = z.infer<typeof EffectSchema>;

/** auto-layout（仅增强版插件返回；旧插件缺省） */
export const AutoLayoutSchema = z.object({
  mode: z.enum(["horizontal", "vertical", "none"]),
  itemSpacing: z.number().optional(),
  paddingTop: z.number().optional(),
  paddingRight: z.number().optional(),
  paddingBottom: z.number().optional(),
  paddingLeft: z.number().optional(),
  primaryAxisAlignItems: z.string().optional(),
  counterAxisAlignItems: z.string().optional(),
  primaryAxisSizingMode: z.string().optional(), // FIXED | AUTO
  counterAxisSizingMode: z.string().optional(),
  layoutWrap: z.string().optional(),
});
export type AutoLayout = z.infer<typeof AutoLayoutSchema>;

export const TextStyleSchema = z.object({
  fontFamily: z.string().optional(),
  fontStyle: z.string().optional(),
  fontWeight: numOrString.optional(),
  fontSize: z.number().optional(),
  textAlignHorizontal: z.string().optional(),
  letterSpacing: numOrString.optional(),
  lineHeightPx: z.number().optional(),
});
export type TextStyle = z.infer<typeof TextStyleSchema>;

const ViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
});

// ---------------------------------------------------------------------------
// 1. 统一节点树
// ---------------------------------------------------------------------------

// children 自引用无法从 z.object 直接推断（会变成 any）。其余字段只在这里定义一次，
// 类型 = z.infer 再交上 children。
const unifiedNodeObject = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  bbox: BBoxSchema.optional(), // absoluteBoundingBox；VECTOR 存根可能只有这个
  fills: z.array(PaintSchema).optional(),
  strokes: z.array(PaintSchema).optional(),
  strokeWeight: z.number().optional(),
  strokeAlign: z.string().optional(),
  individualStrokeWeights: z.record(z.number()).optional(),
  cornerRadius: z.number().optional(),
  rectangleCornerRadii: z.array(z.number()).optional(),
  opacity: z.number().optional(),
  visible: z.boolean().optional(),
  clipsContent: z.boolean().optional(),
  effects: z.array(EffectSchema).optional(),
  layout: AutoLayoutSchema.optional(),
  characters: z.string().optional(),
  textStyle: TextStyleSchema.optional(),
  isAsset: z.boolean().optional(), // 该节点应导出为切图（IMAGE fill / VECTOR / INSTANCE 图形类）
});
export type UnifiedNode = z.infer<typeof unifiedNodeObject> & { children: UnifiedNode[] };

export const UnifiedNodeSchema: z.ZodType<UnifiedNode> = unifiedNodeObject.extend({
  children: z.lazy(() => z.array(UnifiedNodeSchema)),
});

export function parseUnifiedNode(data: unknown): UnifiedNode {
  return parseWith(UnifiedNodeSchema, data, "UnifiedNode");
}

// ---------------------------------------------------------------------------
// 2. GroundTruth v3（v2 超集）
// ---------------------------------------------------------------------------

export const NodeIdSchema = z.string();
/** 纯数字:数字，如 14669:9900。类型保持 string，不在 schema 里收窄格式。 */
export type NodeId = z.infer<typeof NodeIdSchema>;

export const GtSourceSchema = z.object({
  via: z.string(), // 如 "dtc-extract talktofigma-ws(channel=dtc)"
  exported_at: z.string(),
  figma_file: z.string().optional(),
  frame_node_id: NodeIdSchema.optional(),
  tool_version: z.string().optional(),
  plugin_capabilities: z.array(z.string()).optional(), // ["rich-fields:auto-layout", ...]
});
export type GtSource = z.infer<typeof GtSourceSchema>;

export const GtTokensSchema = z.object({
  colors: z.array(z.object({
    name: z.string(),
    value: z.string(),
    nodeId: NodeIdSchema,
    path: z.string().optional(),
  })),
  typography: z.array(z.object({
    name: z.string(),
    fontSize: z.number(),
    fontWeight: numOrString.optional(),
    fontFamily: z.string().optional(),
    lineHeight: numOrString.optional(),
    letterSpacing: numOrString.optional(),
    nodeId: NodeIdSchema,
  })),
  spacing: z.array(z.object({
    name: z.string(),
    value: z.number(),
    nodeId: NodeIdSchema,
    path: z.string().optional(),
  })),
  radius: z.array(z.object({
    name: z.string(),
    value: z.number(),
    nodeId: NodeIdSchema,
    path: z.string().optional(),
  })),
});
export type GtTokens = z.infer<typeof GtTokensSchema>;

export const FillRoleSchema = z.enum(["background", "surface", "gradient-stop", "shadow", "overlay", "other"]);
export type FillRole = z.infer<typeof FillRoleSchema>;

export const StrokeRoleSchema = z.enum(["border", "outline", "divider", "other"]);
export type StrokeRole = z.infer<typeof StrokeRoleSchema>;

export const NodeRoleSchema = z.enum([
  "card", "button", "input", "text", "icon", "container", "badge", "divider",
  "image", "nav", "header", "footer", "table-header", "table-row", "other",
]);
export type NodeRole = z.infer<typeof NodeRoleSchema>;

export const GtRawStyleSchema = z.object({
  nodeId: NodeIdSchema,
  name: z.string().optional(),
  path: z.string().optional(),
  role: NodeRoleSchema,
  fills: z.array(z.object({
    color: z.string(),
    role: FillRoleSchema,
    opacity: z.number().optional(),
    gradientStops: z.array(z.object({
      position: z.number().optional(),
      color: z.string(),
    })).optional(),
  })),
  strokes: z.array(z.object({
    color: z.string(),
    role: StrokeRoleSchema,
    width: z.number().optional(),
  })),
  textColor: z.string().optional(),
  textStyle: z.object({
    ref: z.string().optional(),
    fontSize: z.number().optional(),
    fontWeight: numOrString.optional(),
    fontFamily: z.string().optional(),
    lineHeightPx: z.number().optional(),
    letterSpacing: numOrString.optional(),
  }).optional(),
  cornerRadius: z.number().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
  bbox: BBoxSchema.optional(), // v3：验证环归因要用，v2 没有
  padding: z.string().optional(),
  paddingPx: z.object({
    top: z.number(),
    right: z.number(),
    bottom: z.number(),
    left: z.number(),
  }).optional(),
  gap: z.number().optional(),
  layoutMode: z.enum(["horizontal", "vertical", "none"]).optional(),
  effects: z.array(EffectSchema).optional(), // v3：阴影等
  opacity: z.number().optional(),
});
export type GtRawStyle = z.infer<typeof GtRawStyleSchema>;

export const GroundTruthSchema = z.object({
  schema_version: z.literal(3).optional(),
  source: GtSourceSchema,
  tokens: GtTokensSchema.optional(),
  raw_styles: z.array(GtRawStyleSchema),
});
export type GroundTruth = z.infer<typeof GroundTruthSchema>;

export function parseGroundTruth(data: unknown): GroundTruth {
  return parseWith(GroundTruthSchema, data, "GroundTruth");
}

// ---------------------------------------------------------------------------
// 3. DtcSpec（AI 消费用）
// ---------------------------------------------------------------------------

export const SpecLayoutHintSchema = z.object({
  model: z.enum(["flex-row", "flex-col", "grid", "flow", "absolute", "unknown"]),
  confidence: z.number(), // 0-1
  reason: z.string().optional(),
  inferred: z.literal(true).optional(), // [AI 推断] 标记
});
export type SpecLayoutHint = z.infer<typeof SpecLayoutHintSchema>;

const specNodeObject = z.object({
  id: z.string(),
  name: z.string(),
  role: NodeRoleSchema,
  bbox: BBoxSchema,
  layout: AutoLayoutSchema.optional(), // 来自设计稿 auto-layout（确定性）
  layoutHint: SpecLayoutHintSchema.optional(), // [AI 推断]（无 auto-layout 字段时由几何推断）
  styles: z.object({
    background: z.string().optional(),
    gradient: z.string().optional(), // linear-gradient(...) CSS
    border: z.string().optional(),
    borderRadius: z.number().optional(),
    boxShadow: z.string().optional(),
    opacity: z.number().optional(),
    padding: z.string().optional(),
    gap: z.number().optional(),
  }).optional(),
  text: z.object({
    content: z.string(),
    style: z.record(z.unknown()),
  }).optional(),
  asset: z.string().optional(), // assets/ 下相对路径（.dtc/assets/<id>.png|svg）
});
export type SpecNode = z.infer<typeof specNodeObject> & { children: SpecNode[] };

export const SpecNodeSchema: z.ZodType<SpecNode> = specNodeObject.extend({
  children: z.lazy(() => z.array(SpecNodeSchema)),
});

export const DtcSpecSchema = z.object({
  version: z.literal(1),
  root: SpecNodeSchema,
  viewport: ViewportSchema,
  notes: z.array(z.string()), // 数据缺口/推断说明，供模型与人工审阅
});
export type DtcSpec = z.infer<typeof DtcSpecSchema>;

export function parseDtcSpec(data: unknown): DtcSpec {
  return parseWith(DtcSpecSchema, data, "DtcSpec");
}

// ---------------------------------------------------------------------------
// 4. VerifyReport
// ---------------------------------------------------------------------------

export const AttributedNodeSchema = z.object({
  nodeId: z.string(),
  name: z.string().optional(),
  type: z.string().optional(),
  role: z.string().optional(),
  expected: z.record(z.unknown()).optional(), // ground-truth 期望值
  actual: z.record(z.unknown()).optional(), // DOM computed style 实际值
});
export type AttributedNode = z.infer<typeof AttributedNodeSchema>;

export const DiffRegionSchema = z.object({
  id: z.string(),
  bbox: BBoxSchema,
  diffPixels: z.number(),
  diffRatio: z.number().optional(), // 区域内差异像素占比
  severity: z.enum(["high", "medium", "low"]),
  attributedNodes: z.array(AttributedNodeSchema),
});
export type DiffRegion = z.infer<typeof DiffRegionSchema>;

export const StructureCheckSchema = z.object({
  score: z.number(),
  textChecked: z.number(),
  textMatched: z.number(),
  mismatches: z.array(z.object({
    kind: z.enum(["missing-text", "content", "fontSize", "color", "fontWeight", "position"]),
    nodeId: z.string().optional(),
    expected: z.string().optional(),
    actual: z.string().optional(),
    detail: z.string().optional(),
  })),
});
export type StructureCheck = z.infer<typeof StructureCheckSchema>;

export const VerifyReportSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  round: z.number(),
  target: z.object({
    url: z.string(),
    viewport: ViewportSchema,
    fullPage: z.boolean(),
    state: z.string(),
  }),
  reference: z.object({
    image: z.string(),
    width: z.number(),
    height: z.number(),
    scaleUsed: z.number().optional(),
  }),
  pixel: z.object({
    score: z.number(), // 0-100
    diffRatio: z.number(), // 0-1
    threshold: z.number(),
    diffImage: z.string().optional(),
    clusters: z.number(),
  }),
  structure: StructureCheckSchema.optional(),
  fidelityScore: z.number(), // 0-100 加权综合
  regions: z.array(DiffRegionSchema),
  convergence: z.object({
    threshold: z.number(),
    converged: z.boolean(),
    previousScore: z.number().nullable().optional(),
    stalledRounds: z.number(),
    stop: z.boolean(),
    reason: z.string().optional(),
  }),
  fixPromptPath: z.string().optional(),
});
export type VerifyReport = z.infer<typeof VerifyReportSchema>;

export function parseVerifyReport(data: unknown): VerifyReport {
  return parseWith(VerifyReportSchema, data, "VerifyReport");
}

// ---------------------------------------------------------------------------
// .dtc/ 规格包 manifest
// ---------------------------------------------------------------------------

export const DtcManifestSchema = z.object({
  version: z.literal(1),
  node_id: NodeIdSchema,
  node_name: z.string().optional(),
  figma_file: z.string().optional(),
  exported_at: z.string(),
  via: z.string(),
  plugin_capabilities: z.array(z.string()),
  viewport: ViewportSchema,
  ref_scale: z.number(), // 参考图导出倍率
  assets: z.array(z.object({
    nodeId: z.string(),
    file: z.string(),
    kind: z.string(),
  })),
});
export type DtcManifest = z.infer<typeof DtcManifestSchema>;

export function parseDtcManifest(data: unknown): DtcManifest {
  return parseWith(DtcManifestSchema, data, "DtcManifest");
}

// ---------------------------------------------------------------------------
// 原始 Figma 快照（插件通道 / REST）
//
// 取舍：只拒绝根不是对象或数组的 JSON。插件 ws、read_my_design 数组、REST {nodes}
// 形状各不相同，旧插件也没有 auto-layout / effects 等富字段。在这里按富字段严格校验
// 会把仍能归一化的旧快照判失败。内部结构交给 normalize* 容错，不在 schema 层拒绝。
// ---------------------------------------------------------------------------

export const RawFigmaSnapshotSchema = z.union([
  z.record(z.unknown()),
  z.array(z.unknown()),
], {
  errorMap: (issue, ctx) => {
    if (issue.code === "invalid_union") {
      return { message: "根必须是对象或数组（内部字段保持宽松，不因缺少 auto-layout 等富字段而拒绝）" };
    }
    return { message: ctx.defaultError };
  },
});
export type RawFigmaSnapshot = z.infer<typeof RawFigmaSnapshotSchema>;

export function parseRawFigmaSnapshot(data: unknown): RawFigmaSnapshot {
  return parseWith(RawFigmaSnapshotSchema, data, "原始 Figma 快照");
}
