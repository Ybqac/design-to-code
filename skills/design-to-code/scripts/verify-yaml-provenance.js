#!/usr/bin/env node
/**
 * verify-yaml-provenance.js — fusion-layout-spec.yaml 溯源校验（零依赖）
 *
 * 用法：node verify-yaml-provenance.js <fusion-layout-spec.yaml> <raw-node-snapshot.json>
 *
 * 解析 YAML 里的所有颜色/字号/尺寸值，逐一核验是否在原始节点树里能找到出处。
 * 防止模型在 4a 阶段编值写 YAML（如 #06B6D4 / #F5F5F5 等节点树里根本没有的颜色）。
 *
 * 退出码：有 FORGED 项 → 1，否则 0。
 */

const fs = require('fs');

const [,, yamlPath, snapshotPath] = process.argv;
if (!yamlPath || !snapshotPath) {
  console.error('用法: node verify-yaml-provenance.js <fusion-layout-spec.yaml> <raw-node-snapshot.json>');
  process.exit(2);
}

let yamlText, snapshot;
try { yamlText = fs.readFileSync(yamlPath, 'utf8'); }
catch (e) { console.error(`[ERR] 读 YAML 失败: ${e.message}`); process.exit(2); }
try { snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf8')); }
catch (e) { console.error(`[ERR] 读 snapshot 失败: ${e.message}`); process.exit(2); }

const hexRe = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g;
const yamlColors = new Set();
let m;
while ((m = hexRe.exec(yamlText))) {
  yamlColors.add(m[0].toLowerCase());
}

const realColors = new Set();
const realFontSizes = new Set();
const realDimensions = new Set();

function walk(node) {
  if (node.fills) node.fills.forEach(f => {
    if (f.color) realColors.add(f.color.toLowerCase());
    if (f.gradientStops) f.gradientStops.forEach(s => {
      if (s.color) realColors.add(s.color.toLowerCase());
    });
  });
  if (node.strokes) node.strokes.forEach(s => {
    if (s.color) realColors.add(s.color.toLowerCase());
  });
  if (node.style?.fontSize) realFontSizes.add(node.style.fontSize);
  if (node.strokeWeight !== undefined && node.strokeWeight !== null) {
    realDimensions.add(node.strokeWeight);
  }
  if (node.cornerRadius !== undefined && node.cornerRadius !== null) {
    realDimensions.add(node.cornerRadius);
  }
  if (node.absoluteBoundingBox) {
    realDimensions.add(node.absoluteBoundingBox.width);
    realDimensions.add(node.absoluteBoundingBox.height);
  }
  for (const key of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'itemSpacing', 'counterAxisSpacing']) {
    if (node[key] !== undefined && node[key] !== null) realDimensions.add(node[key]);
  }
  if (node.children) node.children.forEach(walk);
}
walk(snapshot);

function expandShortHex(c) {
  if (c.length === 4) return '#' + c.slice(1).split('').map(x => x + x).join('');
  if (c.length === 5) return '#' + c.slice(1).split('').map(x => x + x).join('');
  return null;
}

function colorVerified(c) {
  if (realColors.has(c)) return true;
  const expanded = expandShortHex(c);
  return expanded ? realColors.has(expanded) : false;
}

const forgedColors = [];
const verifiedColors = [];
for (const c of yamlColors) {
  if (colorVerified(c)) verifiedColors.push(c);
  else forgedColors.push(c);
}

const pxRe = /\b(\d+(?:\.\d+)?)\s*px\b/g;
const yamlPx = new Set();
while ((m = pxRe.exec(yamlText))) {
  yamlPx.add(parseFloat(m[1]));
}

const dimKeyRe = /(?:^|[\s{:,\[])(?:height|width|cornerRadius|gap|strokeWidth|size):\s*(\d+(?:\.\d+)?)(?:\s|$|[,}\]])/gm;
while ((m = dimKeyRe.exec(yamlText))) {
  yamlPx.add(parseFloat(m[1]));
}

const forgedDimensions = [];
const verifiedDimensions = [];
for (const n of yamlPx) {
  const match = [...realDimensions].some(d => Math.abs(d - n) < 0.01);
  if (match) verifiedDimensions.push(n);
  else forgedDimensions.push(n);
}

console.log('=== YAML 溯源校验报告 ===');
console.log(`YAML 颜色: ${yamlColors.size} 个`);
console.log(`YAML 数值(px/尺寸): ${yamlPx.size} 个`);
console.log(`节点树真实颜色: ${realColors.size} 个`);
console.log(`节点树真实数值: ${realDimensions.size + realFontSizes.size} 个`);
console.log(`颜色已验证: ${verifiedColors.length} 个，伪造: ${forgedColors.length} 个`);
console.log(`数值已验证: ${verifiedDimensions.length} 个，伪造: ${forgedDimensions.length} 个`);
console.log();

let hasFail = false;

if (forgedColors.length > 0) {
  hasFail = true;
  console.log(`🔴 [FORGED] ${forgedColors.length} 个颜色不在节点树里——模型在 YAML 里编了值:`);
  forgedColors.forEach(c => console.log(`  ${c}`));
  console.log();
}

if (forgedDimensions.length > 0) {
  hasFail = true;
  console.log(`🔴 [FORGED] ${forgedDimensions.length} 个数值不在节点树里——模型在 YAML 里编了尺寸/间距:`);
  forgedDimensions.slice(0, 20).forEach(n => console.log(`  ${n}`));
  if (forgedDimensions.length > 20) console.log(`  ... 还有 ${forgedDimensions.length - 20} 个`);
  console.log();
}

if (hasFail) {
  console.log('这些值在原始 Figma 节点数据里找不到出处。');
  console.log('模型应该在 4a 阶段从 ground-truth.json / raw-node-snapshot.json 取真实值，不能凭空编。');
  console.log();
  console.log('修复方法：');
  console.log('  1. 从 raw-node-snapshot.json 找到对应元素的真实 fills/strokes/尺寸');
  console.log('  2. 用真实值替换 YAML 里的编造值');
  console.log('  3. 重跑本脚本验证');
  process.exit(1);
}

console.log('✅ YAML 里所有颜色和数值都能在节点树里找到出处');
process.exit(0);
