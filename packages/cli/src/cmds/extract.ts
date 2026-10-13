/**
 * dtc extract —— 确定性提取：一条命令产出 .dtc/ 规格包。
 *
 * 数据通道：
 *  1. 默认：TalkToFigma 插件 ws 通道（需 bun socket relay + Figma 插件连到 --channel）
 *  2. --from-rest：Figma REST API（需 PAT，受限流，CI/无桌面端备用）
 *  3. --from-snapshot：直接读之前落盘的原始 JSON（离线重放/调试）
 *
 * 产物（.dtc/）：
 *  manifest.json / raw-node-snapshot.json / unified-tree.json /
 *  design-ground-truth.json / spec.json / ref/frame.png / assets/<nodeId>.png|.svg
 */
import fs from "node:fs";
import path from "node:path";
import {
  buildGroundTruth,
  buildSpec,
  isAssetNode,
  normalizeAuto,
  normalizeRest,
  normalizeTalkToFigma,
} from "@dtc/core";
import type { UnifiedNode } from "@dtc/core";
import { dtcPaths } from "../paths.js";
import { FigmaRelayClient, nodeIdToFileName, normalizeNodeId } from "../ws-client.js";

export interface ExtractOptions {
  node: string;
  channel?: string;
  out?: string;
  viewport?: string; // WxH，默认取节点 bbox
  refScale?: number; // 参考图倍率，默认 2
  fromRest?: boolean;
  fileKey?: string;
  pat?: string;
  fromSnapshot?: string;
  maxAssets?: number; // 素材导出上限（防 16MB 帧超限/超时），默认 60
  channelUrl?: string;
}

const TOOL_VERSION = "dtc-cli 0.1.0";

export async function runExtract(opts: ExtractOptions): Promise<void> {
  const nodeId = normalizeNodeId(opts.node);
  const outDir = opts.out ?? ".dtc";
  const p = dtcPaths(outDir);
  fs.mkdirSync(p.refDir, { recursive: true });
  fs.mkdirSync(p.assetsDir, { recursive: true });

  let rawSnapshot: unknown;
  let via: string;
  let capabilities: string[] = [];

  if (opts.fromSnapshot) {
    rawSnapshot = JSON.parse(fs.readFileSync(opts.fromSnapshot, "utf8"));
    via = `dtc-extract snapshot(${path.basename(opts.fromSnapshot)})`;
  } else if (opts.fromRest) {
    const { fileKey, pat } = opts;
    if (!fileKey || !pat) throw new Error("--from-rest 需要 --file-key 与 --pat（Figma personal access token）");
    console.log(`→ REST 通道: files/${fileKey}/nodes/${nodeId} ...`);
    const res = await fetch(`https://api.figma.com/v1/files/${fileKey}/nodes?ids=${encodeURIComponent(nodeId)}`, {
      headers: { "X-Figma-Token": pat },
    });
    if (!res.ok) throw new Error(`Figma REST ${res.status}: ${await res.text()}`);
    rawSnapshot = await res.json();
    via = "dtc-extract rest";
  } else {
    const channel = opts.channel ?? "dtc";
    const client = new FigmaRelayClient(opts.channelUrl ? { url: opts.channelUrl } : {});
    try {
      console.log(`→ 插件 ws 通道: join channel "${channel}" ...`);
      await client.join(channel);
      console.log(`→ get_node_info(${nodeId}) ...`);
      rawSnapshot = await client.send("get_node_info", { nodeId }, 60_000);

      console.log(`→ export_node_as_image(根节点, scale=${opts.refScale ?? 2}) → ref/frame.png ...`);
      const img = await client.send<any>("export_node_as_image", { nodeId, scale: opts.refScale ?? 2 }, 120_000);
      if (img?.imageData) {
        fs.writeFileSync(p.refImage, Buffer.from(img.imageData, "base64"));
      } else {
        console.warn(`⚠️ 参考图导出失败：${JSON.stringify(img).slice(0, 120)}`);
      }
      via = `dtc-extract talktofigma-ws(channel=${channel})`;
      void capabilities;
      capabilities = (await extractAssets(client, nodeId, p, opts)).capabilities;
    } finally {
      client.close();
    }
  }

  // 归一化
  const normalized = opts.fromRest
    ? normalizeRest(rawSnapshot)
    : opts.fromSnapshot
      ? normalizeAuto(rawSnapshot)
      : normalizeTalkToFigma(rawSnapshot);
  const root = normalized.root;
  capabilities = Array.from(new Set([...capabilities, ...normalized.capabilities]));

  if (!root.bbox) throw new Error("根节点缺少 absoluteBoundingBox，无法继续");
  const viewport = parseViewport(opts.viewport, root.bbox);

  // 落盘
  fs.writeFileSync(p.rawSnapshot, JSON.stringify(rawSnapshot, null, 2));
  fs.writeFileSync(p.unifiedTree, JSON.stringify(root, null, 2));

  const gt = buildGroundTruth(root, {
    via,
    figmaFile: opts.fileKey,
    frameNodeId: nodeId,
    toolVersion: TOOL_VERSION,
    pluginCapabilities: capabilities,
  });
  fs.writeFileSync(p.groundTruth, JSON.stringify(gt, null, 2));

  const assetMap = collectAssetMap(p.assetsDir, root);
  const spec = buildSpec(root, { viewport, assetMap });
  fs.writeFileSync(p.spec, JSON.stringify(spec, null, 2));

  const manifest = {
    version: 1,
    node_id: nodeId,
    node_name: root.name,
    figma_file: opts.fileKey,
    exported_at: new Date().toISOString(),
    via,
    plugin_capabilities: capabilities,
    viewport,
    ref_scale: opts.refScale ?? 2,
    assets: [...assetMap.entries()].map(([id, file]) => ({ nodeId: id, file, kind: "asset" })),
  };
  fs.writeFileSync(p.manifest, JSON.stringify(manifest, null, 2));

  // 摘要
  const assetCount = assetMap.size;
  console.log(`\n✅ 提取完成 → ${p.root}/`);
  console.log(`   节点树: ${countNodes(root)} 个节点（${countTexts(root)} 文本 / ${assetCount} 素材）`);
  console.log(`   ground-truth raw_styles: ${gt.raw_styles.length} 条`);
  console.log(`   tokens: 颜色 ${gt.tokens?.colors.length ?? 0} / 字体 ${gt.tokens?.typography.length ?? 0} / 间距 ${gt.tokens?.spacing.length ?? 0} / 圆角 ${gt.tokens?.radius.length ?? 0}`);
  console.log(`   视口: ${viewport.width}x${viewport.height}，能力: ${capabilities.join(", ") || "基础字段（旧版插件）"}`);
  if (!capabilities.some((c) => c.startsWith("rich-fields:auto-layout"))) {
    console.log(`   ⚠️ 未检测到 auto-layout 字段——建议安装本仓库 plugin/ 的增强版插件（dtc plugin build）以获得布局字段，复杂布局保真度会显著提升`);
  }
  if (assetCount > 0) console.log(`   素材: ${[...assetMap.values()].map((f) => f).slice(0, 5).join(", ")}${assetCount > 5 ? " ..." : ""}`);
}

// ---------------------------------------------------------------------------
// 素材导出（IMAGE fill / VECTOR / 无子 INSTANCE）
// ---------------------------------------------------------------------------

async function extractAssets(
  client: FigmaRelayClient,
  rootId: string,
  p: ReturnType<typeof dtcPaths>,
  opts: ExtractOptions,
): Promise<{ capabilities: string[] }> {
  // 先拿节点树再挑素材节点
  const rawTree = await client.send("get_node_info", { nodeId: rootId }, 60_000);
  const { root, capabilities } = normalizeTalkToFigma(rawTree);

  const targets: UnifiedNode[] = [];
  const visit = (n: UnifiedNode) => {
    if (n.visible === false) return;
    if (isAssetNode(n)) targets.push(n);
    n.children.forEach(visit);
  };
  visit(root);

  const max = opts.maxAssets ?? 60;
  if (targets.length > max) {
    console.warn(`⚠️ 素材节点 ${targets.length} 个超过上限 ${max}，仅导出面积最大的前 ${max} 个（其余在 spec 中标记缺失）`);
    targets.sort((a, b) => (b.bbox?.width ?? 0) * (b.bbox?.height ?? 0) - (a.bbox?.width ?? 0) * (a.bbox?.height ?? 0));
    targets.length = max;
  }

  let done = 0;
  for (const t of targets) {
    const base = nodeIdToFileName(t.id);
    // VECTOR 且插件支持 SVG 时优先 SVG（增强插件）；失败回退 PNG
    let file = "";
    if (t.type === "VECTOR") {
      try {
        const svg = await client.send<any>("export_node_as_image", { nodeId: t.id, format: "SVG" }, 30_000);
        if (svg?.imageData) {
          file = path.join(p.assetsDir, `${base}.svg`);
          fs.writeFileSync(file, Buffer.from(svg.imageData, "base64"));
        }
      } catch {
        /* 旧插件 format 硬编码 PNG，忽略 */
      }
    }
    if (!file) {
      try {
        const png = await client.send<any>("export_node_as_image", { nodeId: t.id, scale: 2 }, 30_000);
        if (png?.imageData) {
          file = path.join(p.assetsDir, `${base}.png`);
          fs.writeFileSync(file, Buffer.from(png.imageData, "base64"));
        }
      } catch (e: any) {
        console.warn(`⚠️ 素材 ${t.id}(${t.name}) 导出失败: ${e.message}`);
      }
    }
    if (file) {
      done += 1;
      if (done % 10 === 0) console.log(`   素材 ${done}/${targets.length} ...`);
    }
  }
  console.log(`→ 素材导出: ${done}/${targets.length}`);
  return { capabilities };
}

function collectAssetMap(assetsDir: string, root: UnifiedNode): Map<string, string> {
  const map = new Map<string, string>();
  const visit = (n: UnifiedNode) => {
    if (isAssetNode(n)) {
      const base = nodeIdToFileName(n.id);
      for (const ext of [".svg", ".png"]) {
        const f = path.join(assetsDir, base + ext);
        if (fs.existsSync(f)) {
          map.set(n.id, `assets/${base}${ext}`);
          break;
        }
      }
    }
    n.children.forEach(visit);
  };
  visit(root);
  return map;
}

// ---------------------------------------------------------------------------

function parseViewport(v: string | undefined, bbox: { width: number; height: number }): { width: number; height: number } {
  if (!v) return { width: Math.round(bbox.width), height: Math.round(bbox.height) };
  const m = v.match(/^(\d+)[x×](\d+)$/);
  if (!m) throw new Error(`--viewport 格式应为 WxH，如 1440x900`);
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function countNodes(root: UnifiedNode): number {
  return 1 + root.children.reduce((acc, c) => acc + countNodes(c), 0);
}

function countTexts(root: UnifiedNode): number {
  let n = root.type === "TEXT" ? 1 : 0;
  for (const c of root.children) n += countTexts(c);
  return n;
}
