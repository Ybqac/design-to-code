#!/usr/bin/env node
/**
 * verify-ground-truth.js — design-to-code 护栏脚本（零依赖）
 *
 * 用法：
 *   node verify-ground-truth.js <code-dir> <ground-truth.json>
 *
 * 扫描 <code-dir> 下的 .tsx .jsx .vue .wxml .wxss .css .module.css 文件，
 * 提取所有硬编码的：
 *   - 颜色值（#RGB / #RRGGBB / #RRGGBBAA / rgb()/rgba()/hsl()）
 *   - px 字号（font-size / text-[Npx] / fontSize: N）
 *   - px 圆角（border-radius / rounded-[Npx]）
 *   - px 间距（gap/padding/margin 的 Npx）
 * 然后逐一反查 ground-truth.json 的 tokens + raw_styles：
 *   - 命中 token 或 raw 值 → OK（不输出）
 *   - 未命中且该行无"估读"注释 → [UNMATCHED] 红线
 *   - 未命中但同行或下一行带"估读"标记 → [PENDING] 已知
 *
 * 退出码：有 [UNMATCHED] → 1，否则 0。
 */

const fs = require('fs');
const path = require('path');

// ---------- CLI ----------
const [,, codeDirArg, gtPathArg] = process.argv;
if (!codeDirArg || !gtPathArg) {
  console.error('用法: node verify-ground-truth.js <code-dir> <ground-truth.json>');
  process.exit(2);
}
const CODE_DIR = path.resolve(codeDirArg);
const GT_PATH = path.resolve(gtPathArg);

if (!fs.existsSync(CODE_DIR) || !fs.statSync(CODE_DIR).isDirectory()) {
  console.error(`错误: 代码目录不存在或不是目录: ${CODE_DIR}`);
  process.exit(2);
}
if (!fs.existsSync(GT_PATH)) {
  // ground-truth 缺失：把所有命中视为 PENDING（fallback-bitmap-only 场景）
  console.warn(`[WARN] ground-truth.json 不存在 (${GT_PATH})，所有硬编码值将标 [PENDING]。`);
}

// ---------- 扫描的扩展名 ----------
const EXT_RE = /\.(tsx|jsx|vue|wxml|wxss|css|less|scss|module\.css)$/i;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', '.nuxt', 'coverage']);

// ---------- ground-truth 索引 ----------
function buildIndex(gt) {
  const idx = { colors: new Set(), sizes: new Set(), radius: new Set(), spacing: new Set() };
  if (!gt) return idx;
  const norm = (v) => String(v).toLowerCase().trim();
  const pushColor = (v) => {
    if (typeof v === 'string' && v.startsWith('#')) idx.colors.add(norm(v));
  };
  const pushNum = (v) => {
    const n = Number(v);
    if (Number.isFinite(n)) idx.sizes.add(n);
  };
  // tokens
  (gt.tokens?.colors || []).forEach(t => pushColor(t.value));
  (gt.tokens?.typography || []).forEach(t => { pushNum(t.fontSize); });
  (gt.tokens?.spacing || []).forEach(t => pushNum(t.value));
  (gt.tokens?.radius || []).forEach(t => pushNum(t.value));
  // raw_styles
  (gt.raw_styles || []).forEach(s => {
    (s.fills || []).forEach(f => { if (f.color) pushColor(f.color); });
    if (s.cornerRadius != null) pushNum(s.cornerRadius);
    if (s.fontSize != null) pushNum(s.fontSize);
    if (s.itemSpacing != null) pushNum(s.itemSpacing);
  });
  return idx;
}

// ---------- 规则 ----------
const COLOR_RE = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g;
const TAILWIND_COLOR_RE = /(?:bg|text|border|fill|stroke|from|to|via)-\[([^\]]+)\]/g;
const TAILWIND_SIZE_RE = /(?:text|w|h|gap|p|m|rounded)-\[(\d+)(px|rpx|rem|em)?\]/g;
const CSS_NUM_RE = /(?:(?:font-size|border-radius|gap|padding|margin|width|height)\s*:\s*)(\d+)(px|rpx|rem|em)?/gi;
const INLINE_SIZE_RE = /(?:fontSize|borderRadius|gap|padding|margin|width|height)\s*:\s*(?:['"]?)(\d+)(px|rpx|rem|em)?/gi;

const PLACEHOLDER_URL_RE = /placeholder\.(?:com|co)|picsum\.photos|via\.placeholder|loremflickr|unsplash\.com/i;

function normHex(v) {
  v = v.toLowerCase();
  if (v.startsWith('#')) {
    // #RGB → #RRGGBB
    if (v.length === 4) return '#' + v.slice(1).split('').map(c => c + c).join('');
    if (v.length === 5) return '#' + v.slice(1).split('').map(c => c + c).join('');
    return v;
  }
  return v;
}

// 同一行内或下一行注释是否含"估读/pending/待核实/截图估读"
const PENDING_RE = /估读|pending|待核实|todo|截图/i;

function isPending(lines, lineIdx) {
  const cur = lines[lineIdx] || '';
  const next = lines[lineIdx + 1] || '';
  // 尾随注释或在下一行注释
  return PENDING_RE.test(cur) || PENDING_RE.test(next);
}

function hexInIndex(raw, idx) {
  const v = normHex(raw);
  if (idx.colors.has(v)) return true;
  // 也允许带 alpha 的形式匹配前 7 位
  return idx.colors.has(v.slice(0, 7));
}

// ---------- 扫描 ----------
function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const p = path.join(dir, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (EXT_RE.test(name)) out.push(p);
  }
}

function scanFile(file, idx, results) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split(/\r?\n/);
  const rel = path.relative(CODE_DIR, file);

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    const pending = isPending(lines, i);

    // 1. 占位图 URL（红线，无论 ground-truth）
    const pm = line.match(PLACEHOLDER_URL_RE);
    if (pm) {
      results.push({ level: 'UNMATCHED', file: rel, line: lineNo, snippet: line.trim(), value: pm[0], kind: '占位图URL' });
    }

    // 2 + 3. 颜色（hex / rgb / hsl 直接出现，含 tailwind bg-[#xxx] 形式）
    // 同一行的同一颜色值只报一次：先收集本行所有命中的颜色，去重后再判定。
    let m;
    const lineColors = new Set();
    COLOR_RE.lastIndex = 0;
    while ((m = COLOR_RE.exec(line))) lineColors.add(normHex(m[0]));
    TAILWIND_COLOR_RE.lastIndex = 0;
    while ((m = TAILWIND_COLOR_RE.exec(line))) {
      const inner = m[1];
      if (/^#/.test(inner) || /^rgba?\(/.test(inner) || /^hsla?\(/.test(inner)) {
        lineColors.add(normHex(inner));
      }
    }
    for (const v of lineColors) {
      if (hexInIndex(v, idx)) continue;
      results.push({
        level: pending ? 'PENDING' : 'UNMATCHED',
        file: rel, line: lineNo,
        value: v, kind: '颜色',
        snippet: line.trim(),
      });
    }

    // 4. tailwind 任意值尺寸 text-[14px] / gap-[8px] / rounded-[8px]
    TAILWIND_SIZE_RE.lastIndex = 0;
    while ((m = TAILWIND_SIZE_RE.exec(line))) {
      const num = Number(m[1]);
      const unit = m[2] || 'px';
      if (!Number.isFinite(num)) continue;
      // rpx 是小程序单位，ground-truth 是 px，按 2x 折算近似匹配
      const equiv = unit === 'rpx' ? num / 2 : num;
      if (idx.sizes.has(equiv) || idx.sizes.has(num)) continue;
      results.push({
        level: pending ? 'PENDING' : 'UNMATCHED',
        file: rel, line: lineNo,
        value: `${m[1]}${unit}`, kind: '尺寸(tw任意值)',
        snippet: line.trim(),
      });
    }

    // 5. CSS 内联数值
    CSS_NUM_RE.lastIndex = 0;
    while ((m = CSS_NUM_RE.exec(line))) {
      const num = Number(m[1]);
      const unit = (m[2] || '').toLowerCase();
      if (!Number.isFinite(num)) continue;
      const equiv = unit === 'rpx' ? num / 2 : num;
      if (idx.sizes.has(equiv) || idx.sizes.has(num)) continue;
      results.push({
        level: pending ? 'PENDING' : 'UNMATCHED',
        file: rel, line: lineNo,
        value: `${m[1]}${unit || 'px'}`, kind: '尺寸(css)',
        snippet: line.trim(),
      });
    }

    // 6. JS 对象内联数值 fontSize: 14 / borderRadius: 8
    INLINE_SIZE_RE.lastIndex = 0;
    while ((m = INLINE_SIZE_RE.exec(line))) {
      const num = Number(m[1]);
      if (!Number.isFinite(num)) continue;
      if (idx.sizes.has(num)) continue;
      results.push({
        level: pending ? 'PENDING' : 'UNMATCHED',
        file: rel, line: lineNo,
        value: `${m[1]}`, kind: '尺寸(inline)',
        snippet: line.trim(),
      });
    }
  });
}

// ---------- 主流程 ----------
const gtRaw = fs.existsSync(GT_PATH) ? fs.readFileSync(GT_PATH, 'utf8') : null;
let gt = null;
if (gtRaw) {
  try { gt = JSON.parse(gtRaw); }
  catch (e) { console.error(`[ERR] 解析 ground-truth.json 失败: ${e.message}`); process.exit(2); }
}
const idx = buildIndex(gt);

const files = [];
walk(CODE_DIR, files);
if (files.length === 0) {
  console.warn(`[WARN] 在 ${CODE_DIR} 下未找到可扫描文件。`);
}

const results = [];
files.forEach(f => scanFile(f, idx, results));

const unmatched = results.filter(r => r.level === 'UNMATCHED');
const pending = results.filter(r => r.level === 'PENDING');

if (results.length === 0) {
  console.log('✅ 未发现硬编码颜色/尺寸，ground-truth 校验通过。');
  process.exit(0);
}

// 输出
console.log('--- design-to-code ground-truth 校验报告 ---');
console.log(`扫描文件: ${files.length}，命中项: ${results.length}（UNMATCHED: ${unmatched.length}, PENDING: ${pending.length}）\n`);

if (unmatched.length) {
  console.log('🔴 [UNMATCHED] 必须处理:');
  unmatched.forEach(r => {
    console.log(`  ${r.file}:${r.line}  ${r.value.padEnd(12)} (${r.kind})  | ${r.snippet.slice(0, 100)}`);
  });
  console.log('');
}

if (pending.length) {
  console.log('🟡 [PENDING] 已主动标估读，需进交付清单:');
  pending.forEach(r => {
    console.log(`  ${r.file}:${r.line}  ${r.value.padEnd(12)} (${r.kind})  | ${r.snippet.slice(0, 100)}`);
  });
  console.log('');
}

process.exit(unmatched.length ? 1 : 0);
