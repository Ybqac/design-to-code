import { describe, expect, it } from "vitest";
import {
  attributeRegions,
  buildGroundTruth,
  buildSpec,
  clusterDiffPixels,
  evaluateConvergence,
  fidelityScore,
  inferLayoutHint,
  normalizeRest,
  normalizeTalkToFigma,
  pixelScore,
  renderFixPrompt,
  structureCheck,
  type UnifiedNode,
} from "./index.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

const pluginSnapshot = {
  document: {
    id: "14669:9900",
    name: "Login Card",
    type: "FRAME",
    absoluteBoundingBox: { x: 100, y: 200, width: 360, height: 640 },
    fills: [{ type: "SOLID", color: "#FFFFFF" }],
    strokes: [{ type: "SOLID", color: "#E5E7EB" }],
    strokeWeight: 1,
    cornerRadius: 12,
    // 增强插件字段
    layoutMode: "VERTICAL",
    itemSpacing: 16,
    paddingTop: 24,
    paddingRight: 24,
    paddingBottom: 24,
    paddingLeft: 24,
    effects: [{ type: "DROP_SHADOW", color: "rgba(0,0,0,0.16)", offset: { x: 0, y: 4 }, radius: 12 }],
    children: [
      {
        id: "14669:9901",
        name: "Submit Button",
        type: "FRAME",
        absoluteBoundingBox: { x: 124, y: 700, width: 312, height: 48 },
        fills: [{ type: "SOLID", color: "#3B82F6" }],
        cornerRadius: 8,
        layoutMode: "HORIZONTAL",
        itemSpacing: 8,
        children: [
          {
            id: "14669:9902",
            name: "Button Label",
            type: "TEXT",
            characters: "登录",
            absoluteBoundingBox: { x: 200, y: 712, width: 40, height: 24 },
            fills: [{ type: "SOLID", color: "#FFFFFF" }],
            style: { fontFamily: "Inter", fontWeight: 600, fontSize: 16, lineHeightPx: 24 },
          },
        ],
      },
      {
        id: "14669:9903",
        name: "close icon",
        type: "VECTOR",
        absoluteBoundingBox: { x: 420, y: 220, width: 16, height: 16 },
      },
    ],
  },
};

const restSnapshot = {
  nodes: {
    "1:2": {
      document: {
        id: "1:2",
        name: "Root",
        type: "FRAME",
        absoluteBoundingBox: { x: 0, y: 0, width: 100, height: 100 },
        fills: [{ type: "SOLID", color: { r: 1, g: 0.5, b: 0, a: 0.5 } }],
        layoutMode: "HORIZONTAL",
        itemSpacing: 10,
        children: [
          { id: "1:3", name: "T", type: "TEXT", characters: "hi", absoluteBoundingBox: { x: 0, y: 40, width: 20, height: 20 }, style: { fontSize: 14 } },
        ],
      },
    },
  },
};

describe("normalize", () => {
  it("插件快照 → UnifiedNode（hex 颜色、富字段、VECTOR 存根）", () => {
    const { root, capabilities } = normalizeTalkToFigma(pluginSnapshot);
    expect(root.id).toBe("14669:9900");
    expect(root.fills?.[0].color).toBe("#ffffff");
    expect(root.layout?.mode).toBe("vertical");
    expect(root.layout?.itemSpacing).toBe(16);
    expect(root.effects?.[0].type).toBe("DROP_SHADOW");
    const vec = root.children.find((c) => c.type === "VECTOR");
    expect(vec?.bbox?.width).toBe(16);
    expect(capabilities).toContain("rich-fields:auto-layout");
    expect(capabilities).toContain("vector-stub");
  });

  it("REST 快照 → UnifiedNode（浮点色转 hex + alpha）", () => {
    const { root } = normalizeRest(restSnapshot);
    expect(root.fills?.[0].color).toBe("#ff800080");
    expect(root.layout?.itemSpacing).toBe(10);
    expect(root.children[0].characters).toBe("hi");
  });

  it("旧版插件字段缺失时容错", () => {
    const legacy = { document: { id: "1:1", name: "L", type: "FRAME", absoluteBoundingBox: { x: 0, y: 0, width: 10, height: 10 }, fills: [{ type: "SOLID", color: "#000000" }] } };
    const { root, capabilities } = normalizeTalkToFigma(legacy);
    expect(root.layout).toBeUndefined();
    expect(root.effects).toBeUndefined();
    expect(capabilities).not.toContain("rich-fields:auto-layout");
  });
});

describe("ground-truth", () => {
  const { root } = normalizeTalkToFigma(pluginSnapshot);
  const gt = buildGroundTruth(root, { via: "test" });

  it("逐节点生成 raw_styles（含 VECTOR 存根与 TEXT）", () => {
    const ids = gt.raw_styles.map((s) => s.nodeId);
    expect(ids).toContain("14669:9900");
    expect(ids).toContain("14669:9902");
    expect(ids).toContain("14669:9903");
  });

  it("TEXT 节点带 textColor/textStyle；按钮 role 正确", () => {
    const label = gt.raw_styles.find((s) => s.nodeId === "14669:9902");
    expect(label?.textColor).toBe("#ffffff");
    expect(label?.textStyle?.fontSize).toBe(16);
    const btn = gt.raw_styles.find((s) => s.nodeId === "14669:9901");
    expect(btn?.role).toBe("button");
    expect(btn?.fills[0].color).toBe("#3b82f6");
  });

  it("token 去重且 nodeId 可溯源", () => {
    const colors = gt.tokens?.colors ?? [];
    expect(colors.length).toBeGreaterThanOrEqual(3);
    for (const c of colors) expect(c.nodeId).toMatch(/^\d+:\d+$/);
  });

  it("v3 字段：bbox/effects/paddingPx", () => {
    const card = gt.raw_styles.find((s) => s.nodeId === "14669:9900");
    expect(card?.bbox?.width).toBe(360);
    expect(card?.paddingPx?.top).toBe(24);
    expect(card?.effects?.[0].radius).toBe(12);
  });
});

describe("layout-infer", () => {
  const mk = (id: string, x: number, y: number, w = 40, h = 40): UnifiedNode => ({
    id, name: id, type: "FRAME", bbox: { x, y, width: w, height: h }, children: [],
  });

  it("水平等距 → flex-row 高置信", () => {
    const container: UnifiedNode = { id: "c", name: "c", type: "FRAME", bbox: { x: 0, y: 0, width: 300, height: 40 }, children: [mk("a", 0, 0), mk("b", 110, 0), mk("c2", 220, 0)] };
    const hint = inferLayoutHint(container);
    expect(hint?.model).toBe("flex-row");
    expect(hint?.inferred).toBe(true);
    expect(hint!.confidence).toBeGreaterThan(0.7);
  });

  it("垂直排列 → flex-col", () => {
    const container: UnifiedNode = { id: "c", name: "c", type: "FRAME", bbox: { x: 0, y: 0, width: 40, height: 300 }, children: [mk("a", 0, 0, 40, 40), mk("b", 0, 130, 40, 40), mk("c2", 0, 260, 40, 40)] };
    expect(inferLayoutHint(container)?.model).toBe("flex-col");
  });

  it("互相重叠 → absolute", () => {
    const container: UnifiedNode = { id: "c", name: "c", type: "FRAME", bbox: { x: 0, y: 0, width: 100, height: 100 }, children: [mk("a", 0, 0, 90, 90), mk("b", 5, 5, 90, 90)] };
    expect(inferLayoutHint(container)?.model).toBe("absolute");
  });
});

describe("spec", () => {
  it("auto-layout 优先、资产挂路径、notes 说明缺口", () => {
    const { root } = normalizeTalkToFigma(pluginSnapshot);
    // 外面套一层无 auto-layout 的容器，触发几何推断（[AI 推断]）
    const wrapped: UnifiedNode = {
      id: "0:1", name: "Page", type: "FRAME",
      bbox: { x: 0, y: 0, width: 360, height: 700 },
      children: [
        { id: "0:2", name: "Spacer A", type: "FRAME", bbox: { x: 0, y: 0, width: 360, height: 20 }, children: [] },
        root,
        { id: "0:3", name: "Spacer B", type: "FRAME", bbox: { x: 0, y: 660, width: 360, height: 20 }, children: [] },
      ],
    };
    const spec = buildSpec(wrapped, { viewport: { width: 360, height: 640 }, assetMap: new Map([["14669:9903", "assets/14669_9903.png"]]) });
    const card = findByName(spec.root, "Login Card");
    expect(card?.layout?.mode).toBe("vertical");
    expect(spec.root.layoutHint?.inferred).toBe(true);
    expect(JSON.stringify(spec)).toContain("assets/14669_9903.png");
    const textNode = findByName(spec.root, "Button Label");
    expect(textNode?.text?.content).toBe("登录");
    expect(spec.notes.join(" ")).toContain("[AI 推断]");
  });
});

function findByName(node: any, name: string): any {
  if (node.name === name) return node;
  for (const c of node.children ?? []) {
    const r = findByName(c, name);
    if (r) return r;
  }
  return undefined;
}

describe("diff-cluster", () => {
  it("两个分离色块 → 两个热区，面积降序", () => {
    const regions = clusterDiffPixels(200, 200, (x, y) => (x < 40 && y < 40) || (x >= 100 && x < 140 && y >= 100 && y < 140));
    expect(regions.length).toBe(2);
    expect(regions[0].diffPixels).toBeGreaterThanOrEqual(regions[1].diffPixels);
    expect(regions[0].severity).toBe("high");
  });

  it("无差异 → 空", () => {
    expect(clusterDiffPixels(100, 100, () => false)).toEqual([]);
  });

  it("细小噪点被过滤", () => {
    const regions = clusterDiffPixels(500, 500, (x, y) => x === 10 && y === 10);
    expect(regions.length).toBe(0);
  });
});

describe("attribute", () => {
  it("热区映射回 Figma 坐标并归因到节点", () => {
    const { root } = normalizeTalkToFigma(pluginSnapshot);
    const gt = buildGroundTruth(root, { via: "test" });
    // 视口 360 宽对齐 360 宽画板：scale=1，offset = 根 bbox
    const regions = attributeRegions(
      [{ id: "r1", bbox: { x: 0, y: 500, width: 360, height: 60 }, diffPixels: 5000, severity: "high", attributedNodes: [] }],
      root,
      { scale: 1, offsetX: 100, offsetY: 200 },
      gt,
      new Map(),
    );
    expect(regions[0].attributedNodes.length).toBeGreaterThan(0);
    const ids = regions[0].attributedNodes.map((n) => n.nodeId);
    expect(ids).toContain("14669:9901");
    const btn = regions[0].attributedNodes.find((n) => n.nodeId === "14669:9901");
    expect(btn?.expected?.background).toBe("#3b82f6");
  });
});

describe("score & convergence", () => {
  it("像素分与加权分", () => {
    expect(pixelScore(0.05)).toBe(95);
    expect(fidelityScore({ diffRatio: 0.05, threshold: 0.1, structure: { score: 100, textChecked: 1, textMatched: 1, mismatches: [] } })).toBe(96.5);
  });

  it("达到阈值 → 收敛停止", () => {
    const s = evaluateConvergence(96, undefined, { threshold: 95, minImprovement: 0.5, maxStalledRounds: 3, maxRounds: 10 }, 3);
    expect(s.converged).toBe(true);
    expect(s.stop).toBe(true);
  });

  it("连续无改进 → 停滞停止", () => {
    const r1 = { fidelityScore: 80, convergence: { threshold: 95, converged: false, stalledRounds: 2, stop: false } } as any;
    const s = evaluateConvergence(80.2, r1, { threshold: 95, minImprovement: 0.5, maxStalledRounds: 3, maxRounds: 10 }, 4);
    expect(s.stop).toBe(true);
    expect(s.reason).toContain("停滞");
  });

  it("结构校验：字号/颜色不匹配被捕获", () => {
    const sc = structureCheck(
      [{ content: "登录", fontSize: 14, color: "rgb(96, 165, 250)" }],
      [{ nodeId: "1:1", content: "登录", fontSize: 16, textColor: "#3B82F6" }],
    );
    expect(sc.score).toBe(0);
    expect(sc.mismatches.map((m) => m.kind)).toContain("fontSize");
    expect(sc.mismatches.map((m) => m.kind)).toContain("color");
  });
});

describe("fix-prompt", () => {
  it("渲染带归因的修正指令", () => {
    const report = {
      version: 1 as const,
      generated_at: new Date().toISOString(),
      round: 2,
      target: { url: "http://localhost:5173", viewport: { width: 360, height: 640 }, fullPage: false, state: "default" },
      reference: { image: "ref/frame.png", width: 720, height: 1280, scaleUsed: 2 },
      pixel: { score: 88, diffRatio: 0.12, threshold: 0.1, clusters: 1 },
      structure: { score: 100, textChecked: 1, textMatched: 1, mismatches: [] },
      fidelityScore: 91.6,
      regions: [
        {
          id: "r1", bbox: { x: 0, y: 500, width: 360, height: 60 }, diffPixels: 5000, severity: "high",
          attributedNodes: [{ nodeId: "14669:9901", name: "Submit Button", role: "button", expected: { background: "#3b82f6" }, actual: { background: "rgb(96, 165, 250)" } }],
        },
      ],
      convergence: { threshold: 95, converged: false, previousScore: 90, stalledRounds: 0, stop: false },
    } as any;
    const md = renderFixPrompt(report);
    expect(md).toContain("14669:9901");
    expect(md).toContain("#3b82f6");
    expect(md).toContain("rgb(96, 165, 250)");
    expect(md).toContain("第 2 轮");
  });
});
