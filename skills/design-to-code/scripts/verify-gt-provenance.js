#!/usr/bin/env node
/**
 * verify-gt-provenance.js — ground-truth 溯源校验（零依赖）
 *
 * 用法：node verify-gt-provenance.js <ground-truth.json> <raw-node-snapshot.json>
 *
 * 拿 ground-truth.json 和 TalkToFigma 返回的原始节点树快照逐一核对：
 *   - tokens.colors 的每个值必须在节点树的 fills/strokes 里能找到（颜色溯源）
 *   - tokens.typography 的每个 fontSize 必须在节点树的 style.fontSize 里能找到
 *   - tokens.spacing 的每个值必须在节点树的 padding/itemSpacing 里能找到
 *   - tokens.radius 的每个值必须在节点树的 cornerRadius 里能找到
 *   - raw_styles 条数 / 节点总数 必须 > 20%（覆盖率，防只填几条偷懒）
 *   - raw_styles 的每个 nodeId 必须在节点树里存在
 *
 * 退出码：有 FORGED 项 → 1，否则 0。
 */

const fs = require('fs');
const path = require('path');

const [,, gtPath, snapshotPath] = process.argv;
if (!gtPath || !snapshotPath) {
  console.error('用法: node verify-gt-provenance.js <ground-truth.json> <raw-node-snapshot.json>');
  process.exit(2);
}

let gt, snapshot;
try { gt = JSON.parse(fs.readFileSync(gtPath, 'utf8')); }
catch (e) { console.error(`[ERR] 解析 ground-truth.json 失败: ${e.message}`); process.exit(2); }
try { snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); }
catch (e) { console.error(`[ERR] 解析 raw-node-snapshot.json 失败: ${e.message}`); process.exit(2); }

// ---------- 收集节点树的真实值 ----------
let nodeCount = 0;
const real = {
  colors: new Set(),
  fontSizes: new Set(),
  spacings: new Set(),
  radii: new Set(),
  nodeIds: new Set(),
};

function walk(node) {
  nodeCount++;
  if (node.id) real.nodeIds.add(node.id);
  if (node.fills) node.fills.forEach(f => {
    if (f.color) real.colors.add(f.color.toLowerCase());
    if (f.gradientStops) f.gradientStops.forEach(s => {
      if (s.color) real.colors.add(s.color.toLowerCase());
    });
  });
  if (node.strokes) node.strokes.forEach(s => {
    if (s.color) real.colors.add(s.color.toLowerCase());
  });
  if (node.style) {
    if (node.style.fontSize) real.fontSizes.add(node.style.fontSize);
  }
  if (node.cornerRadius !== undefined && node.cornerRadius !== null) real.radii.add(node.cornerRadius);
  // spacing: paddingTop/Right/Bottom/Left, itemSpacing
  for (const key of ['paddingTop','paddingRight','paddingBottom','paddingLeft','itemSpacing','counterAxisSpacing']) {
    if (node[key] !== undefined && node[key] !== null) real.spacings.add(node[key]);
  }
  // absoluteBoundingBox width/height 也算 spacing 候选（尺寸）
  if (node.absoluteBoundingBox) {
    real.spacings.add(node.absoluteBoundingBox.width);
    real.spacings.add(node.absoluteBoundingBox.height);
  }
  if (node.children) node.children.forEach(walk);
}
walk(snapshot);

// ---------- 逐项溯源 ----------
const forged = [];

// 1. 颜色溯源
const colors = gt.tokens?.colors || [];
let colorForged = 0;
for (const c of colors) {
  if (!real.colors.has(c.value.toLowerCase())) {
    forged.push({ type: 'color', value: c.value, name: c.name, nodeId: c.nodeId, reason: '不在节点树 fills/strokes 里' });
    colorForged++;
  }
}

// 2. 字号溯源
const typography = gt.tokens?.typography || [];
let typoForged = 0;
for (const t of typography) {
  if (t.fontSize !== undefined && !real.fontSizes.has(t.fontSize)) {
    forged.push({ type: 'fontSize', value: t.fontSize, name: t.name, nodeId: t.nodeId, reason: '不在节点树 style.fontSize 里' });
    typoForged++;
  }
}

// 3. 间距溯源
const spacings = gt.tokens?.spacing || [];
let spacingForged = 0;
for (const s of spacings) {
  if (s.value !== undefined && !real.spacings.has(s.value)) {
    forged.push({ type: 'spacing', value: s.value, name: s.name, nodeId: s.nodeId, reason: '不在节点树 padding/itemSpacing/size 里' });
    spacingForged++;
  }
}

// 4. 圆角溯源
const radii = gt.tokens?.radius || [];
let radiusForged = 0;
for (const r of radii) {
  if (r.value !== undefined && !real.radii.has(r.value)) {
    forged.push({ type: 'radius', value: r.value, name: r.name, nodeId: r.nodeId, reason: '不在节点树 cornerRadius 里' });
    radiusForged++;
  }
}

// 5. raw_styles 覆盖率
const rawStylesCount = (gt.raw_styles || []).length;
const coverage = nodeCount > 0 ? rawStylesCount / nodeCount : 0;
const coverageLow = coverage < 0.2;

// 6. raw_styles nodeId 存在性
let nodeIdMissing = 0;
for (const s of (gt.raw_styles || [])) {
  if (s.nodeId && !real.nodeIds.has(s.nodeId)) {
    forged.push({ type: 'nodeId', value: s.nodeId, reason: 'raw_styles 的 nodeId 不在节点树里' });
    nodeIdMissing++;
  }
}

// ---------- 输出报告 ----------
console.log('=== ground-truth 溯源校验报告 ===');
console.log(`节点树: ${nodeCount} 个节点`);
console.log(`真实值: ${real.colors.size} 颜色, ${real.fontSizes.size} 字号, ${real.spacings.size} 间距, ${real.radii.size} 圆角`);
console.log();

console.log(`颜色溯源: ${colors.length} 个 token, ${colorForged} 个伪造 (${colorForged ? '❌' : '✅'})`);
console.log(`字号溯源: ${typography.length} 个 token, ${typoForged} 个伪造 (${typoForged ? '❌' : '✅'})`);
console.log(`间距溯源: ${spacings.length} 个 token, ${spacingForged} 个伪造 (${spacingForged ? '❌' : '✅'})`);
console.log(`圆角溯源: ${radii.length} 个 token, ${radiusForged} 个伪造 (${radiusForged ? '❌' : '✅'})`);
console.log(`raw_styles 覆盖率: ${rawStylesCount}/${nodeCount} = ${(coverage*100).toFixed(1)}% (${coverageLow ? '❌ 偏低（<20%）' : '✅'})`);
console.log(`raw_styles nodeId 存在性: ${nodeIdMissing} 个不存在 (${nodeIdMissing ? '❌' : '✅'})`);
console.log();

if (forged.length > 0) {
  console.log(`🔴 [FORGED] ${forged.length} 个值无法溯源到真实节点数据:`);
  // 按类型分组输出，避免太长
  const byType = {};
  for (const f of forged) {
    if (!byType[f.type]) byType[f.type] = [];
    byType[f.type].push(f);
  }
  for (const [type, items] of Object.entries(byType)) {
    console.log(`\n  ${type}（${items.length} 个）:`);
    for (const f of items.slice(0, 10)) {
      console.log(`    ${f.value} — ${f.reason}${f.name ? ' (name: ' + f.name + ')' : ''}${f.nodeId ? ' (nodeId: ' + f.nodeId + ')' : ''}`);
    }
    if (items.length > 10) console.log(`    ... 还有 ${items.length - 10} 个`);
  }
  console.log();
}

if (coverageLow) {
  console.log(`🔴 [COVERAGE_LOW] raw_styles 只覆盖 ${(coverage*100).toFixed(1)}% 的节点（${rawStylesCount}/${nodeCount}），要求 >20%`);
  console.log('  模型可能偷懒只填了几条 raw_styles，没逐节点生成');
  console.log();
}

const hasFail = forged.length > 0 || coverageLow;
console.log(hasFail ? `❌ 溯源校验失败：${forged.length} 个伪造值 + ${coverageLow ? '覆盖率偏低' : '覆盖率正常'}` : '✅ 溯源校验通过：所有值都能在真实节点数据里找到出处');
process.exit(hasFail ? 1 : 0);
