#!/usr/bin/env node
/**
 * dtc-hook.js — Antigravity design-to-code 护栏 hook 脚本（零依赖）
 *
 * 按 Antigravity 官方 hooks 契约（https://antigravity.google/docs/ide/hooks）：
 *   - stdin 收到 JSON：{ toolCall: {name, args: {TargetFile, CodeContent, ReplacementContent, ...}}, workspacePaths, ... }
 *   - stdout 输出 JSON 控制 decision：allow / deny / ask / force_ask
 *   - 阻断靠 stdout 的 decision 字段，不靠 exit code
 *
 * 本脚本聚焦三件 ESLint 抓不到的事（硬编码颜色/字号交 ESLint）：
 *   1. 占位图 URL（placeholder.com / picsum.photos / unsplash 随机图）
 *   2. lorem ipsum 占位文案
 *   3. （扩展位）凭空造非 src/components/ 路径的组件 import —— 留 TODO，当前只拦 1/2
 *
 * PostToolUse 在官方契约里 stdout 是空 {}，不能用来反馈模型。
 * 所以本脚本只在 PreToolUse 有意义；其他事件调用时直接 allow 放行。
 */

const fs = require('fs');
const path = require('path');

const FRONTEND_RE = /\.(tsx|jsx|ts|js|vue|wxml|wxss|css|less|scss|svelte)$/i;
const PLACEHOLDER_URL_RE = /placeholder\.(?:com|co)|picsum\.photos|via\.placeholder|loremflickr|unsplash\.com|placehold\.co/i;
const LOREM_RE = /\blorem\s+ipsum\b/i;

function readStdin() {
  return new Promise((resolve) => {
    let buf = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (buf += c));
    process.stdin.on('end', () => resolve(buf));
    setTimeout(() => resolve(buf), 3000); // 兜底：3 秒超时放行
  });
}

// 从 toolCall.args 提取目标文件路径与待写入内容
function extractTarget(payload) {
  const tc = payload.toolCall || {};
  const name = tc.name || '';
  const args = tc.args || {};
  let filePath = args.TargetFile || args.targetFile || args.AbsolutePath || args.DirectoryPath || '';
  let content = '';
  if (name === 'write_to_file') {
    content = args.CodeContent || args.codeContent || '';
  } else if (name === 'replace_file_content') {
    content = args.ReplacementContent || args.replacementContent || '';
  } else if (name === 'multi_replace_file_content') {
    const chunks = args.ReplacementChunks || args.replacementChunks || [];
    if (Array.isArray(chunks)) {
      content = chunks.map(c => (c && (c.ReplacementContent || c.replacementContent)) || '').join('\n');
    }
  }
  return { name, filePath, content };
}

function scan(content) {
  const violations = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, i) => {
    const ln = i + 1;
    const m1 = line.match(PLACEHOLDER_URL_RE);
    if (m1) violations.push({ line: ln, kind: '占位图URL', detail: `匹配 ${m1[0]}`, snippet: line.trim().slice(0, 100) });
    if (LOREM_RE.test(line)) violations.push({ line: ln, kind: 'lorem ipsum', detail: '占位文案', snippet: line.trim().slice(0, 100) });
  });
  return violations;
}

function emit(decision, reason) {
  const out = { decision };
  if (reason) out.reason = reason;
  console.log(JSON.stringify(out));
  process.exit(0);
}

async function main() {
  const raw = await readStdin();
  let payload = {};
  try { payload = JSON.parse(raw); } catch { emit('allow'); return; }

  // 只对 PreToolUse（带 toolCall）有意义；其他事件放行
  if (!payload.toolCall) { emit('allow'); return; }

  const { name, filePath, content } = extractTarget(payload);
  if (!filePath || !FRONTEND_RE.test(filePath)) emit('allow');
  if (!content) emit('allow');

  const violations = scan(content);
  if (violations.length === 0) emit('allow');

  const relName = path.basename(filePath);
  const list = violations.map(v => `  - L${v.line} [${v.kind}] ${v.snippet}`).join('\n');
  const reason = `design-to-code 反捏造护栏：${relName} 含 ${violations.length} 处违规，请修复后再写：\n${list}`;
  emit('ask', reason);
}

main().catch(() => emit('allow'));
