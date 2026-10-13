/**
 * dtc check —— 反捏造机械校验（移植自原仓库两个零依赖脚本并升级）：
 *
 *  A. 溯源校验（verify-gt-provenance.js）：ground-truth 每个值必须能在
 *     raw-node-snapshot.json 的节点树里找到出处——防"从生成代码反向补录伪造"。
 *  B. 代码扫描（verify-ground-truth.js）：扫描代码目录的硬编码颜色/字号/圆角/
 *     间距，反查 ground-truth；占位图 URL 直接红线。
 *
 * 退出码：0=通过；1=有 UNMATCHED/FORGED；2=用法错误。
 */
import fs from "node:fs";
import path from "node:path";
import type { GroundTruth } from "@dtc/core";
import { dtcPaths } from "../paths.js";

export interface CheckOptions {
  codeDir: string;
  out?: string; // .dtc 目录
  skipProvenance?: boolean;
  skipScan?: boolean;
}

// ---------------------------------------------------------------------------
// A. 溯源校验
// ---------------------------------------------------------------------------

interface Forged {
  type: string;
  value: unknown;
  name?: string;
  nodeId?: string;
  reason: string;
}

function collectRealValues(snapshot: any) {
  let nodeCount = 0;
  const real = { colors: new Set<string>(), fontSizes: new Set<number>(), spacings: new Set<number>(), radii: new Set<number>(), nodeIds: new Set<string>() };
  const walk = (node: any) => {
    nodeCount++;
    if (node.id) real.nodeIds.add(node.id);
    const addPaint = (arr: any[]) => {
      for (const f of arr ?? []) {
        if (f.color) real.colors.add(String(f.color).toLowerCase());
        for (const s of f.gradientStops ?? []) if (s.color) real.colors.add(String(s.color).toLowerCase());
      }
    };
    // 插件快照 {document} / REST {nodes:{id:{document}}} / 直接节点
    addPaint(node.fills);
    addPaint(node.strokes);
    if (node.style?.fontSize) real.fontSizes.add(Number(node.style.fontSize));
    if (node.cornerRadius != null) real.radii.add(Number(node.cornerRadius));
    for (const key of ["paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "itemSpacing", "counterAxisSpacing"]) {
      if (node[key] != null) real.spacings.add(Number(node[key]));
    }
    if (node.absoluteBoundingBox) {
      real.spacings.add(Number(node.absoluteBoundingBox.width));
      real.spacings.add(Number(node.absoluteBoundingBox.height));
    }
    for (const c of node.children ?? []) walk(c);
  };
  const snap: any = snapshot;
  const firstNode: any = snap?.nodes ? Object.values(snap.nodes)[0] : undefined;
  const doc: any = snap?.document ?? firstNode?.document ?? snap;
  if (Array.isArray(snapshot)) (snapshot as any[]).forEach((n: any) => walk(n.document ?? n));
  else walk(doc);
  return { nodeCount, real };
}

export function runProvenance(gt: GroundTruth, snapshot: any, log = true): { forged: Forged[]; coverageLow: boolean; nodeCount: number } {
  const { nodeCount, real } = collectRealValues(snapshot);
  const forged: Forged[] = [];

  for (const c of gt.tokens?.colors ?? []) {
    if (!real.colors.has(c.value.toLowerCase())) forged.push({ type: "color", value: c.value, name: c.name, nodeId: c.nodeId, reason: "不在节点树 fills/strokes 里" });
  }
  for (const t of gt.tokens?.typography ?? []) {
    if (t.fontSize !== undefined && !real.fontSizes.has(t.fontSize)) forged.push({ type: "fontSize", value: t.fontSize, name: t.name, nodeId: t.nodeId, reason: "不在节点树 style.fontSize 里" });
  }
  for (const s of gt.tokens?.spacing ?? []) {
    if (!real.spacings.has(s.value)) forged.push({ type: "spacing", value: s.value, name: s.name, nodeId: s.nodeId, reason: "不在节点树 padding/itemSpacing/size 里" });
  }
  for (const r of gt.tokens?.radius ?? []) {
    if (!real.radii.has(r.value)) forged.push({ type: "radius", value: r.value, name: r.name, nodeId: r.nodeId, reason: "不在节点树 cornerRadius 里" });
  }
  const rawCount = gt.raw_styles?.length ?? 0;
  const coverage = nodeCount > 0 ? rawCount / nodeCount : 0;
  for (const s of gt.raw_styles ?? []) {
    if (!real.nodeIds.has(s.nodeId)) forged.push({ type: "nodeId", value: s.nodeId, reason: "raw_styles 的 nodeId 不在节点树里" });
  }
  const coverageLow = coverage < 0.2;

  if (log) {
    console.log(`=== A. 溯源校验（gt ↔ 原始节点树）===`);
    console.log(`节点树 ${nodeCount} 个节点；颜色 ${real.colors.size} / 字号 ${real.fontSizes.size} / 间距 ${real.spacings.size} / 圆角 ${real.radii.size} 个真实值`);
    console.log(`raw_styles 覆盖率: ${rawCount}/${nodeCount} = ${(coverage * 100).toFixed(1)}%${coverageLow ? " ❌（<20%）" : " ✅"}`);
    if (forged.length) {
      console.log(`🔴 [FORGED] ${forged.length} 项无法溯源:`);
      for (const f of forged.slice(0, 10)) console.log(`   ${f.type} ${String(f.value)} — ${f.reason}`);
      if (forged.length > 10) console.log(`   ... 还有 ${forged.length - 10} 项`);
    } else {
      console.log(`✅ 所有 token/raw_styles 值都能在原始节点树里找到出处`);
    }
  }
  return { forged, coverageLow, nodeCount };
}

// ---------------------------------------------------------------------------
// B. 代码扫描（硬编码值反查 ground-truth + 占位图红线）
// ---------------------------------------------------------------------------

const EXT_RE = /\.(tsx|jsx|vue|svelte|wxml|wxss|css|less|scss|module\.css|html?)$/i;
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage", ".dtc"]);
const COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const TW_COLOR_RE = /(?:bg|text|border|fill|stroke|from|to|via)-\[([^\]]+)\]/g;
const TW_SIZE_RE = /(?:text|w|h|gap|p|m|rounded)-\[(\d+)(px|rpx|rem|em)?\]/g;
const CSS_NUM_RE = /(?:(?:font-size|border-radius|gap|padding|margin|width|height)\s*:\s*)(\d+)(px|rpx|rem|em)?/gi;
const INLINE_SIZE_RE = /(?:fontSize|borderRadius|gap|padding|margin|width|height)\s*:\s*(?:['"]?)(\d+)(px|rpx|rem|em)?/gi;
const PLACEHOLDER_URL_RE = /placeholder\.(?:com|co)|picsum\.photos|via\.placeholder|loremflickr|lorem\.picsum|unsplash\.com/i;
const PENDING_RE = /估读|pending|待核实|todo|截图/i;

export interface ScanResult {
  level: "UNMATCHED" | "PENDING";
  file: string;
  line: number;
  value: string;
  kind: string;
  snippet: string;
}

function buildIndex(gt: GroundTruth | null) {
  const idx = { colors: new Set<string>(), sizes: new Set<number>() };
  if (!gt) return idx;
  const pushColor = (v?: string) => {
    if (typeof v === "string" && (v.startsWith("#") || /^rgba?\(/.test(v))) idx.colors.add(v.toLowerCase());
  };
  const pushNum = (v?: number) => {
    if (Number.isFinite(v)) idx.sizes.add(v as number);
  };
  for (const t of gt.tokens?.colors ?? []) pushColor(t.value);
  for (const t of gt.tokens?.typography ?? []) pushNum(t.fontSize);
  for (const t of gt.tokens?.spacing ?? []) pushNum(t.value);
  for (const t of gt.tokens?.radius ?? []) pushNum(t.value);
  for (const s of gt.raw_styles ?? []) {
    for (const f of s.fills ?? []) pushColor(f.color);
    for (const f of s.strokes ?? []) pushColor(f.color);
    pushColor(s.textColor);
    pushNum(s.cornerRadius);
    pushNum(s.textStyle?.fontSize);
    pushNum(s.gap);
    // v3：尺寸值也纳入（归因后模型可用真实宽高）
    if (s.width) pushNum(Math.round(s.width));
    if (s.height) pushNum(Math.round(s.height));
  }
  return idx;
}

function normHex(v: string): string {
  v = v.toLowerCase();
  if (v.startsWith("#") && (v.length === 4 || v.length === 5)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
  return v;
}

export function scanCode(codeDir: string, gt: GroundTruth | null): ScanResult[] {
  const idx = buildIndex(gt);
  const results: ScanResult[] = [];
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of fs.readdirSync(dir)) {
      if (SKIP_DIRS.has(name)) continue;
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isDirectory()) walk(fp);
      else if (EXT_RE.test(name)) files.push(fp);
    }
  };
  if (!fs.existsSync(codeDir)) throw new Error(`代码目录不存在: ${codeDir}`);
  walk(codeDir);

  const colorInIndex = (raw: string) => {
    const v = normHex(raw);
    return idx.colors.has(v) || idx.colors.has(v.slice(0, 7));
  };

  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      const lineNo = i + 1;
      const pending = PENDING_RE.test(line) || PENDING_RE.test(lines[i + 1] ?? "");
      let m: RegExpMatchArray | null;

      if ((m = line.match(PLACEHOLDER_URL_RE))) {
        results.push({ level: "UNMATCHED", file: path.relative(codeDir, file), line: lineNo, value: m[0], kind: "占位图URL", snippet: line.trim() });
      }

      const lineColors = new Set<string>();
      COLOR_RE.lastIndex = 0;
      while ((m = COLOR_RE.exec(line))) lineColors.add(normHex(m[0]));
      TW_COLOR_RE.lastIndex = 0;
      while ((m = TW_COLOR_RE.exec(line))) {
        if (/^#|^rgba?\(|^hsla?\(/.test(m[1])) lineColors.add(normHex(m[1]));
      }
      for (const v of lineColors) {
        if (colorInIndex(v)) continue;
        results.push({ level: pending ? "PENDING" : "UNMATCHED", file: path.relative(codeDir, file), line: lineNo, value: v, kind: "颜色", snippet: line.trim() });
      }

      TW_SIZE_RE.lastIndex = 0;
      while ((m = TW_SIZE_RE.exec(line))) {
        const num = Number(m[1]);
        const unit = m[2] || "px";
        const equiv = unit === "rpx" ? num / 2 : num;
        if (idx.sizes.has(equiv) || idx.sizes.has(num)) continue;
        results.push({ level: pending ? "PENDING" : "UNMATCHED", file: path.relative(codeDir, file), line: lineNo, value: `${m[1]}${unit}`, kind: "尺寸(tw)", snippet: line.trim() });
      }

      CSS_NUM_RE.lastIndex = 0;
      while ((m = CSS_NUM_RE.exec(line))) {
        const num = Number(m[1]);
        const unit = (m[2] ?? "").toLowerCase();
        const equiv = unit === "rpx" ? num / 2 : num;
        if (idx.sizes.has(equiv) || idx.sizes.has(num)) continue;
        results.push({ level: pending ? "PENDING" : "UNMATCHED", file: path.relative(codeDir, file), line: lineNo, value: `${m[1]}${unit || "px"}`, kind: "尺寸(css)", snippet: line.trim() });
      }

      INLINE_SIZE_RE.lastIndex = 0;
      while ((m = INLINE_SIZE_RE.exec(line))) {
        const num = Number(m[1]);
        if (idx.sizes.has(num)) continue;
        results.push({ level: pending ? "PENDING" : "UNMATCHED", file: path.relative(codeDir, file), line: lineNo, value: m[1], kind: "尺寸(inline)", snippet: line.trim() });
      }
    });
  }
  return results;
}

// ---------------------------------------------------------------------------
// 命令入口
// ---------------------------------------------------------------------------

export async function runCheck(opts: CheckOptions): Promise<number> {
  const p = dtcPaths(opts.out ?? ".dtc");
  if (!fs.existsSync(p.groundTruth)) throw new Error(`ground-truth 不存在: ${p.groundTruth}（先运行 dtc extract）`);
  const gt: GroundTruth = JSON.parse(fs.readFileSync(p.groundTruth, "utf8"));

  let failed = false;

  if (!opts.skipProvenance) {
    if (fs.existsSync(p.rawSnapshot)) {
      const snapshot = JSON.parse(fs.readFileSync(p.rawSnapshot, "utf8"));
      const { forged, coverageLow } = runProvenance(gt, snapshot);
      if (forged.length || coverageLow) failed = true;
    } else {
      console.log(`⚠️ raw-node-snapshot.json 不存在，跳过溯源校验`);
    }
  }

  if (!opts.skipScan) {
    console.log(`\n=== B. 代码扫描（硬编码值 ↔ ground-truth）===`);
    const results = scanCode(opts.codeDir, gt);
    const unmatched = results.filter((r) => r.level === "UNMATCHED");
    const pending = results.filter((r) => r.level === "PENDING");
    if (results.length === 0) {
      console.log(`✅ 未发现未溯源的硬编码颜色/尺寸`);
    } else {
      console.log(`命中 ${results.length} 项（UNMATCHED ${unmatched.length}，PENDING ${pending.length}）`);
      if (unmatched.length) {
        console.log(`🔴 [UNMATCHED] 必须处理:`);
        for (const r of unmatched.slice(0, 20)) console.log(`   ${r.file}:${r.line}  ${r.value.padEnd(14)} (${r.kind})`);
        if (unmatched.length > 20) console.log(`   ... 还有 ${unmatched.length - 20} 项`);
        failed = true;
      }
      if (pending.length) {
        console.log(`🟡 [PENDING] 已标估读，需进交付清单: ${pending.length} 项`);
      }
    }
  }

  console.log(failed ? `\n❌ check 未通过` : `\n✅ check 通过`);
  return failed ? 1 : 0;
}
