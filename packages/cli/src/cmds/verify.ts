/**
 * dtc verify —— 视觉回归闭环：渲染截图 → pixelmatch → 热区聚类 → nodeId 归因 →
 * report-N.json + diff.png + impl.png + fix-prompt.md。
 *
 * 退出码（CI/agent 门禁）：0=已收敛；1=还有差距（继续下一轮）；2=停滞/达轮次上限（人工介入）。
 */
import fs from "node:fs";
import path from "node:path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { chromium } from "playwright";
import {
  attributeRegions,
  clusterDiffPixels,
  evaluateConvergence,
  fidelityScore,
  findNodeAtPoint,
  pixelScore,
  renderFixPrompt,
  structureCheck,
} from "@dtc/core";
import type { DomProbe, GroundTruth, UnifiedNode, VerifyReport } from "@dtc/core";
import { readPng, writePng, alignTo } from "../image.js";
import { dtcPaths, nextRound, reportPath } from "../paths.js";

export interface VerifyOptions {
  url: string; // http(s):// 或 file:// 或本地 html 路径
  out?: string; // .dtc 目录
  viewport?: string; // WxH 覆盖 manifest
  fullPage?: boolean;
  round?: number; // 默认自动递增
  pixelThreshold?: number; // pixelmatch threshold，默认 0.1
  scoreThreshold?: number; // 收敛分数线，默认 95
  maxStalled?: number; // 停滞轮数，默认 3
  maxRounds?: number; // 轮次上限，默认 10
  waitMs?: number; // 额外等待，默认 500
}

const PROBE_REGIONS = 12; // 最多探针的热区数

export async function runVerify(opts: VerifyOptions): Promise<number> {
  const p = dtcPaths(opts.out ?? ".dtc");
  if (!fs.existsSync(p.refImage)) throw new Error(`参考图不存在: ${p.refImage}（先运行 dtc extract）`);
  if (!fs.existsSync(p.groundTruth)) throw new Error(`ground-truth 不存在: ${p.groundTruth}`);
  if (!fs.existsSync(p.unifiedTree)) throw new Error(`unified-tree 不存在: ${p.unifiedTree}`);

  const gt: GroundTruth = JSON.parse(fs.readFileSync(p.groundTruth, "utf8"));
  const root: UnifiedNode = JSON.parse(fs.readFileSync(p.unifiedTree, "utf8"));
  if (!root.bbox) throw new Error("unified-tree 根节点缺 bbox");

  const manifest = fs.existsSync(p.manifest) ? JSON.parse(fs.readFileSync(p.manifest, "utf8")) : {};
  const viewport = opts.viewport
    ? parseViewport(opts.viewport)
    : manifest.viewport ?? { width: Math.round(root.bbox.width), height: Math.round(root.bbox.height) };

  const round = opts.round ?? nextRound(p.verifyDir);
  fs.mkdirSync(p.verifyDir, { recursive: true });

  // 1. 渲染截图
  const target = normalizeUrl(opts.url);
  console.log(`→ Playwright: ${target} @ ${viewport.width}x${viewport.height}${opts.fullPage ? " (fullPage)" : ""}`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
  await page.goto(target, { waitUntil: "networkidle", timeout: 60_000 }).catch(async (e: Error) => {
    // 某些 dev server networkidle 慢，回退 load
    await page.goto(target, { waitUntil: "load", timeout: 60_000 }).catch(() => {
      throw e;
    });
  });
  await page.evaluate(() => document.fonts?.ready?.catch(() => {}));
  if (opts.waitMs) await page.waitForTimeout(opts.waitMs);
  const shotBuf = await page.screenshot({ fullPage: opts.fullPage ?? false });
  const implPng = PNG.sync.read(shotBuf);

  // 2. 对齐 + diff
  const refPng = readPng(p.refImage);
  const refAligned = alignTo(implPng, refPng);
  const diffPng = new PNG({ width: implPng.width, height: implPng.height });
  const threshold = opts.pixelThreshold ?? 0.1;
  const diffPixels = pixelmatch(refAligned.data as any, implPng.data as any, diffPng.data as any, implPng.width, implPng.height, {
    threshold,
    includeAA: false,
    alpha: 0.3,
    diffColor: [255, 0, 255], // 品红：与常见设计色区分，供聚类复扫
    diffColorAlt: [255, 0, 255],
  });
  const totalPixels = implPng.width * implPng.height;
  const diffRatio = diffPixels / totalPixels;
  writePng(path.join(p.verifyDir, "impl.png"), implPng);
  writePng(path.join(p.verifyDir, "diff.png"), diffPng);
  console.log(`→ pixelmatch: ${diffPixels}/${totalPixels} 差异像素（ratio=${(diffRatio * 100).toFixed(2)}%）`);

  // 3. 热区聚类（扫描 diff 图上的品红标记）
  const regions = clusterDiffPixels(implPng.width, implPng.height, (x: number, y: number) => {
    const i = (y * implPng.width + x) * 4;
    return diffPng.data[i] > 250 && diffPng.data[i + 2] > 250 && diffPng.data[i + 1] < 20;
  });
  console.log(`→ 聚类: ${regions.length} 个热区`);

  // 4. DOM 探针：热区中心 elementFromPoint + 全页文本节点
  const transform = {
    scale: root.bbox.width / implPng.width,
    offsetX: root.bbox.x,
    offsetY: root.bbox.y,
  };
  const probes = new Map<string, DomProbe>();
  const probePoints = regions.slice(0, PROBE_REGIONS).map((r: { id: string; bbox: { x: number; y: number; width: number; height: number } }) => ({
    regionId: r.id,
    x: Math.min(implPng.width - 1, Math.max(0, Math.round(r.bbox.x + r.bbox.width / 2))),
    y: Math.min(implPng.height - 1, Math.max(0, Math.round(r.bbox.y + r.bbox.height / 2))),
  }));
  const probeResults: Array<(DomProbe & { x: number; y: number }) | null> = await page.evaluate((points) => {
    return points.map((pt: { x: number; y: number }) => {
      const el = document.elementFromPoint(pt.x, pt.y);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return {
        x: pt.x,
        y: pt.y,
        tag: el.tagName.toLowerCase(),
        text: (el.textContent ?? "").trim().slice(0, 40),
        background: cs.backgroundColor,
        color: cs.color,
        fontSize: cs.fontSize,
        fontWeight: cs.fontWeight,
        borderRadius: cs.borderRadius,
        boxShadow: cs.boxShadow !== "none" ? cs.boxShadow : undefined,
        size: { width: rect.width, height: rect.height },
        snippet: `${el.tagName.toLowerCase()}${el.className && typeof el.className === "string" ? "." + el.className.split(/\s+/).slice(0, 2).join(".") : ""}`,
      };
    });
  }, probePoints);
  for (const pr of probeResults) {
    if (!pr) continue;
    const fx = pr.x * transform.scale + transform.offsetX;
    const fy = pr.y * transform.scale + transform.offsetY;
    const node = findNodeAtPoint(root, fx, fy);
    if (node && !probes.has(node.id)) {
      const { x: _x, y: _y, ...probe } = pr;
      probes.set(node.id, probe);
    }
  }

  // 5. 结构校验（文本内容/字号/颜色）
  const domTexts = await page.evaluate(() => {
    const out: Array<{ content: string; fontSize: number; color: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    while (walker.nextNode()) {
      const t = walker.currentNode as Text;
      const content = (t.textContent ?? "").trim();
      if (!content) continue;
      const el = t.parentElement;
      if (!el || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      out.push({ content, fontSize: parseFloat(cs.fontSize), color: cs.color });
    }
    return out;
  });
  const gtTexts = gt.raw_styles
    .filter((s: { role?: string; name?: string }) => s.role === "text" && s.name !== undefined)
    .map((s: { nodeId: string; name?: string; textStyle?: { fontSize?: number; fontWeight?: number | string }; textColor?: string }) => ({
      nodeId: s.nodeId,
      content: (s.name ?? "").replace(/\\n/g, " ").trim(), // 旧版快照 text 内容存于 name
      fontSize: s.textStyle?.fontSize,
      textColor: s.textColor,
      fontWeight: s.textStyle?.fontWeight,
    }));
  // unified tree 里有更准的 characters，优先
  const gtTextsFromTree: Array<{ nodeId: string; content: string; fontSize?: number; textColor?: string; fontWeight?: number | string }> = [];
  const walkText = (n: UnifiedNode) => {
    if (n.type === "TEXT" && n.characters) {
      const raw = gt.raw_styles.find((s) => s.nodeId === n.id);
      gtTextsFromTree.push({
        nodeId: n.id,
        content: n.characters.replace(/\s+/g, " ").trim(),
        fontSize: n.textStyle?.fontSize,
        textColor: raw?.textColor,
        fontWeight: n.textStyle?.fontWeight,
      });
    }
    n.children.forEach(walkText);
  };
  walkText(root);
  const structure = structureCheck(domTexts, gtTextsFromTree.length ? gtTextsFromTree : gtTexts);
  console.log(`→ 结构校验: 文本 ${structure.textMatched}/${structure.textChecked} 匹配（score=${structure.score}）`);

  await browser.close();

  // 6. 归因（DOM 探针 keyed by nodeId）
  attributeRegions(regions, root, transform, gt, probes);

  // 7. 评分 + 收敛
  const pScore = pixelScore(diffRatio);
  const fScore = fidelityScore({ diffRatio, threshold, structure });
  const prevPath = reportPath(p.verifyDir, round - 1);
  const previous = round > 1 && fs.existsSync(prevPath) ? (JSON.parse(fs.readFileSync(prevPath, "utf8")) as VerifyReport) : undefined;
  const convergence = evaluateConvergence(
    fScore,
    previous,
    { threshold: opts.scoreThreshold ?? 95, minImprovement: 0.5, maxStalledRounds: opts.maxStalled ?? 3, maxRounds: opts.maxRounds ?? 10 },
    round,
  );

  const report: VerifyReport = {
    version: 1,
    generated_at: new Date().toISOString(),
    round,
    target: { url: opts.url, viewport, fullPage: opts.fullPage ?? false, state: "default" },
    reference: { image: "ref/frame.png", width: refPng.width, height: refPng.height, scaleUsed: manifest.ref_scale },
    pixel: { score: pScore, diffRatio, threshold, diffImage: "diff.png", clusters: regions.length },
    structure,
    fidelityScore: fScore,
    regions,
    convergence,
  };
  const rp = reportPath(p.verifyDir, round);
  fs.writeFileSync(rp, JSON.stringify(report, null, 2));

  const fixPrompt = renderFixPrompt(report, "../ref/frame.png", "./diff.png");
  const fp = path.join(p.verifyDir, "fix-prompt.md");
  fs.writeFileSync(fp, fixPrompt);
  report.fixPromptPath = fp;

  // 8. 摘要
  console.log(`\n📊 第 ${round} 轮验证 → ${rp}`);
  console.log(`   Fidelity Score: ${fScore}/100（像素 ${pScore} + 结构 ${structure.score}，阈值 ${convergence.threshold}）`);
  if (previous) console.log(`   上轮: ${previous.fidelityScore} → 本轮: ${fScore}`);
  const top = regions.slice(0, 5);
  for (const r of top) {
    const b = r.bbox;
    const nodes = r.attributedNodes.map((n) => `${n.nodeId}${n.name ? `(${n.name})` : ""}`).join(", ");
    console.log(`   ${r.id} [${r.severity}] (${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)}x${Math.round(b.height)}) ${r.diffPixels}px → ${nodes || "未归因"}`);
  }
  if (structure.mismatches.length) {
    console.log(`   结构不匹配 ${structure.mismatches.length} 条（详见 report）`);
  }
  if (convergence.converged) {
    console.log(`\n✅ 已收敛（${convergence.reason}）。fix-prompt: ${fp}`);
    return 0;
  }
  if (convergence.stop) {
    console.log(`\n⛔ 停止迭代: ${convergence.reason}。剩余差异与建议见: ${fp}`);
    return 2;
  }
  console.log(`\n🟡 继续修正 → 按 ${fp} 修复后重新运行 dtc verify`);
  return 1;
}

function parseViewport(v: string): { width: number; height: number } {
  const m = v.match(/^(\d+)[x×](\d+)$/);
  if (!m) throw new Error(`--viewport 格式应为 WxH`);
  return { width: parseInt(m[1], 10), height: parseInt(m[2], 10) };
}

function normalizeUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  if (url.startsWith("file://")) return url;
  const abs = path.resolve(url);
  return "file://" + abs;
}
