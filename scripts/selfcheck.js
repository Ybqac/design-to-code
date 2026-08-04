#!/usr/bin/env node
/**
 * selfcheck.js — design-to-code plugin 自检脚本（零依赖）
 *
 * 用法：node scripts/selfcheck.js
 *
 * 检查整条链路是否通：
 *   1. plugin 文件完整性
 *   2. Node 可用性
 *   3. Antigravity 安装环境（plugin 目录 / skill 软链 / GEMINI.md 约束追加）
 *   4a. Figma MCP（TalkToFigma 或 Framelink）在位（至少一个数据源）
 *   4b. TalkToFigma 在配置中（主流程首选，绕开 Figma REST 限流）
 *   4c. MCP 启动命令可用（bun for TalkToFigma，figma-developer-mcp for Framelink）
 *   5. hook 脚本 dtc-hook.js（占位图/lorem 能拦、正常能放行）
 *   6. verify 脚本 verify-ground-truth.js（UNMATCHED/PENDING/OK 三态）
 *
 * 退出码：全部通过 0，有失败 1。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const PLUGIN_ROOT = path.resolve(__dirname, '..');
const HOME = os.homedir();
const GEMINI_DIR = path.join(HOME, '.gemini');
const CONFIG_DIR = path.join(GEMINI_DIR, 'config');
const PLUGINS_DIR = path.join(CONFIG_DIR, 'plugins');
const SKILLS_DIR = path.join(CONFIG_DIR, 'skills');
const GEMINI_MD = path.join(GEMINI_DIR, 'GEMINI.md');
const MCP_CONFIG = path.join(CONFIG_DIR, 'mcp_config.json');

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
}

// ---------- 1. 文件完整性 ----------
function checkFiles() {
  const required = [
    'plugin.json',
    'hooks.json',
    'rules/design-to-code.md',
    'scripts/dtc-hook.js',
    'scripts/selfcheck.js',
    'skills/design-to-code/SKILL.md',
    'skills/design-to-code/scripts/verify-ground-truth.js',
    'skills/design-to-code/references/fusion-protocol.md',
    'skills/design-to-code/references/anti-fabrication.md',
    'skills/design-to-code/references/ground-truth-lock.md',
    'skills/design-to-code/references/framework-react.md',
    'skills/design-to-code/references/framework-vue.md',
    'skills/design-to-code/references/framework-miniapp.md',
    'skills/design-to-code/references/fallback-bitmap-only.md',
  ];
  const missing = required.filter(f => !fs.existsSync(path.join(PLUGIN_ROOT, f)));
  check(
    '1. plugin 文件完整性',
    missing.length === 0,
    missing.length ? `缺少: ${missing.join(', ')}` : `全部 ${required.length} 个必需文件在位`
  );
}

// ---------- 2. Node ----------
function checkNode() {
  const version = process.version;
  const major = parseInt(version.slice(1), 10);
  check('2. Node 版本', major >= 16, `${version} ${major >= 16 ? '(>=16 OK)' : '(需要 >=16)'}`);
}

// ---------- 3. Antigravity 安装环境 ----------
function checkAntigravityEnv() {
  // 3a. plugin 用户级目录
  const userPlugin = path.join(PLUGINS_DIR, 'design-to-code');
  const userPluginOk = fs.existsSync(path.join(userPlugin, 'plugin.json'));
  check('3a. plugin 用户级安装', userPluginOk,
    userPluginOk ? `~/.gemini/config/plugins/design-to-code/ 在位` : `~/.gemini/config/plugins/design-to-code/ 不存在（非必需，仅当想跨项目用 user 级时才需要）`);

  // 3b. skill 软链（用户级或共享位置）
  const skillPaths = [
    path.join(SKILLS_DIR, 'design-to-code'),
    path.join(HOME, '.agents', 'skills', 'design-to-code'),
  ];
  const skillFound = skillPaths.find(p => fs.existsSync(path.join(p, 'SKILL.md')));
  check('3b. skill 可发现', !!skillFound,
    skillFound ? `找到: ${skillFound}` : `未在 ~/.gemini/config/skills/ 或 ~/.agents/skills/ 找到 design-to-code skill`);

  // 3c. GEMINI.md 含 design-to-code 约束
  let geminiOk = false;
  let geminiDetail = `${GEMINI_MD} 不存在`;
  if (fs.existsSync(GEMINI_MD)) {
    const txt = fs.readFileSync(GEMINI_MD, 'utf8');
    geminiOk = /design-to-code/i.test(txt);
    geminiDetail = geminiOk ? 'GEMINI.md 已含 design-to-code 约束' : 'GEMINI.md 未含 design-to-code 约束（需手动并入 templates/gemini-md-fragment.md）';
  }
  check('3c. GEMINI.md 全局约束', geminiOk, geminiDetail);
}

// ---------- 4. Figma MCP 配置 ----------
// 检查所有可能的 mcp_config.json 路径——Antigravity 有多个配置目录，
// IDE 读的未必是 config/ 那份。任一不一致就报警，防止"自检通过但 IDE 读错文件"。
// 主流程用 TalkToFigma；Framelink 作为备份（受 Figma REST 限流）。
const MCP_PATHS = [
  path.join(GEMINI_DIR, 'config', 'mcp_config.json'),           // 标准 user 级
  path.join(GEMINI_DIR, 'antigravity-ide', 'mcp_config.json'),  // IDE 专属
  path.join(GEMINI_DIR, 'antigravity', 'mcp_config.json'),      // 2.0 桌面端
];

function checkMcp() {
  // 4a. 所有已知路径都必须有 TalkToFigma 或 Framelink（至少一个 Figma 数据源）
  const pathResults = MCP_PATHS.map(p => {
    if (!fs.existsSync(p)) return { path: p, exists: false, servers: [], hasFramelink: false, hasTalkToFigma: false, hasF2c: false };
    try {
      const cfg = JSON.parse(fs.readFileSync(p, 'utf8'));
      const servers = Object.keys(cfg.mcpServers || {});
      return {
        path: p, exists: true, servers,
        hasFramelink: servers.some(s => /framelink/i.test(s)),
        hasTalkToFigma: servers.some(s => /talktofigma/i.test(s)),
        hasF2c: servers.some(s => /f2c/i.test(s)),
      };
    } catch (e) {
      return { path: p, exists: true, parseError: e.message, servers: [], hasFramelink: false, hasTalkToFigma: false, hasF2c: false };
    }
  });

  // 4a. 所有路径都必须有 Figma 数据源（TalkToFigma 主流程，或 Framelink 备份，至少其一）
  const allHaveFigmaSource = pathResults.every(r => r.hasFramelink || r.hasTalkToFigma);
  const shortPath = (p) => p.replace(HOME, '~');

  check('4a. Figma MCP（TalkToFigma 或 Framelink）在所有配置路径中就位', allHaveFigmaSource,
    allHaveFigmaSource
      ? `所有 ${pathResults.length} 个路径都有 Figma 数据源（TalkToFigma/Framelink）`
      : '部分路径缺 Figma 数据源:\n' + pathResults.filter(r => !(r.hasFramelink || r.hasTalkToFigma)).map(r => `    ${shortPath(r.path)} → ${r.exists ? (r.servers.join(',') || '(空)') : '(文件不存在)'}`).join('\n'));

  // 4b. TalkToFigma 是否在配置里（主流程首选，绕开 Figma REST 限流）
  const anyHasTalkToFigma = pathResults.some(r => r.hasTalkToFigma);
  check('4b. TalkToFigma MCP 在配置中（主流程首选）', anyHasTalkToFigma,
    anyHasTalkToFigma ? '✅ TalkToFigma 已配置（走 WebSocket+插件，绕开 Figma REST 限流）' : '⚠️ TalkToFigma 未配置——主流程将退回 Framelink（受 Figma REST 429 限流）。建议配 TalkToFigma：在 mcp_config.json 加 TalkToFigma server');

  // 4c. 检测 figma-developer-mcp 命令是否全局可用（用于 Framelink）+ bun 命令（用于 TalkToFigma）
  // 兜底：bun 默认装在 ~/.bun/bin，子 shell PATH 可能不含，额外检查该路径文件是否存在
  let framelinkCmd = null, bunCmd = null;
  try {
    framelinkCmd = execFileSync('which', ['figma-developer-mcp'], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) { framelinkCmd = null; }
  try {
    bunCmd = execFileSync('which', ['bun'], { encoding: 'utf8', timeout: 3000 }).trim();
  } catch (e) {
    const bunFallback = path.join(HOME, '.bun', 'bin', 'bun');
    if (fs.existsSync(bunFallback)) bunCmd = bunFallback; else bunCmd = null;
  }

  const parts = [];
  if (anyHasTalkToFigma) parts.push(bunCmd ? '✅ bun 在 PATH（TalkToFigma 启动器）' : '⚠️ bun 未安装（TalkToFigma 需要：curl -fsSL https://bun.sh/install | bash）');
  if (pathResults.some(r => r.hasFramelink)) parts.push(framelinkCmd ? '✅ figma-developer-mcp 在 PATH（Framelink 备份）' : '⚠️ figma-developer-mcp 未全局安装（npm install -g figma-developer-mcp，Framelink 备份需要）');

  const cmdOk = (!anyHasTalkToFigma || !!bunCmd) && (!pathResults.some(r => r.hasFramelink) || !!framelinkCmd);
  check('4c. MCP 启动命令可用', cmdOk, parts.join('；') || '无已配置 MCP 需要的启动命令');
}

// ---------- 5. hook 脚本 ----------
function checkHook() {
  const hookScript = path.join(PLUGIN_ROOT, 'scripts', 'dtc-hook.js');
  if (!fs.existsSync(hookScript)) { check('5. hook 脚本', false, 'dtc-hook.js 不存在'); return; }

  const run = (payload) => {
    const tmp = path.join(os.tmpdir(), `dtc-selfcheck-${Date.now()}.json`);
    fs.writeFileSync(tmp, JSON.stringify(payload));
    let out;
    try {
      out = execFileSync('node', [hookScript], { input: fs.readFileSync(tmp), encoding: 'utf8', timeout: 5000 });
    } catch (e) {
      out = e.stdout || '';
    } finally {
      fs.unlinkSync(tmp);
    }
    try { return JSON.parse(out); } catch { return { decision: '__parse_error__', raw: out }; }
  };

  // 5a. 占位图 URL 应被 ask 拦
  const r1 = run({
    toolCall: { name: 'write_to_file', args: { TargetFile: '/tmp/Test.tsx', CodeContent: '<img src="https://picsum.photos/40" />' } }
  });
  check('5a. hook 拦占位图 URL', r1.decision === 'ask', `decision=${r1.decision}`);

  // 5b. lorem ipsum 应被 ask 拦
  const r2 = run({
    toolCall: { name: 'write_to_file', args: { TargetFile: '/tmp/Test.tsx', CodeContent: '<p>lorem ipsum dolor</p>' } }
  });
  check('5b. hook 拦 lorem ipsum', r2.decision === 'ask', `decision=${r2.decision}`);

  // 5c. 正常代码应放行
  const r3 = run({
    toolCall: { name: 'write_to_file', args: { TargetFile: '/tmp/Test.tsx', CodeContent: '<div className="bg-surface">正常</div>' } }
  });
  check('5c. hook 放行正常代码', r3.decision === 'allow', `decision=${r3.decision}`);

  // 5d. 非前端文件应放行
  const r4 = run({
    toolCall: { name: 'write_to_file', args: { TargetFile: '/tmp/README.md', CodeContent: '<img src="https://picsum.photos/40" />' } }
  });
  check('5d. hook 放行非前端文件', r4.decision === 'allow', `decision=${r4.decision}`);
}

// ---------- 6. verify 脚本 ----------
function checkVerify() {
  const verifyScript = path.join(PLUGIN_ROOT, 'skills', 'design-to-code', 'scripts', 'verify-ground-truth.js');
  if (!fs.existsSync(verifyScript)) { check('6. verify 脚本', false, 'verify-ground-truth.js 不存在'); return; }

  const tmpDir = path.join(os.tmpdir(), `dtc-verify-${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const srcDir = path.join(tmpDir, 'src');
  fs.mkdirSync(srcDir, { recursive: true });

  // ground-truth.json：含 primary 颜色 + body 14px
  fs.writeFileSync(path.join(tmpDir, 'gt.json'), JSON.stringify({
    tokens: {
      colors: [{ name: 'primary', value: '#3B82F6', nodeId: '1:2' }],
      typography: [{ name: 'body', fontSize: 14, nodeId: '2:2' }],
      spacing: [{ name: 'gap-md', value: 12, nodeId: '3:1' }],
      radius: [{ name: 'card-radius', value: 8, nodeId: '1:2' }],
    },
    raw_styles: [{ nodeId: '1:2', fills: [{ type: 'SOLID', color: '#3B82F6' }], cornerRadius: 8, itemSpacing: 12, fontSize: 14 }],
  }));

  // 测试代码：含命中项 + 占位图(UNMATCHED) + 估读项(PENDING)
  fs.writeFileSync(path.join(srcDir, 'Card.tsx'),
    `<div className="bg-[#3B82F6] rounded-[8px] text-[14px] gap-[12px]">
  <span className="text-[#FF0000]">正常文案</span>
  <img src="https://picsum.photos/40" />
  <div className="bg-[#999999]">  {/* 截图估读 */}
</div>`
  );

  let out, exitCode = 0;
  try {
    out = execFileSync('node', [verifyScript, srcDir, path.join(tmpDir, 'gt.json')], { encoding: 'utf8', timeout: 5000 });
  } catch (e) {
    out = e.stdout || '';
    exitCode = e.status || 1;
  }

  // 验证三态：UNMATCHED 命中（含 FF0000 + picsum）、PENDING 命中（999999）、退出码非零
  const hasUnmatched = /UNMATCHED/.test(out) && /#ff0000|picsum/i.test(out);
  const hasPending = /PENDING/.test(out) && /#999999/i.test(out);
  const exitCorrect = exitCode !== 0;

  check('6. verify 三态识别',
    hasUnmatched && hasPending && exitCorrect,
    `UNMATCHED=${hasUnmatched}, PENDING=${hasPending}, exit=${exitCode}（应为非0）`);

  // 清理
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
}

// ---------- 主流程 ----------
console.log('=== design-to-code plugin 自检 ===');
console.log(`plugin 路径: ${PLUGIN_ROOT}\n`);

checkFiles();
checkNode();
checkAntigravityEnv();
checkMcp();
checkHook();
checkVerify();

// 输出
let pass = 0, fail = 0;
for (const r of results) {
  const mark = r.ok ? '✅' : '❌';
  console.log(`${mark} ${r.name}`);
  console.log(`    ${r.detail}`);
  if (r.ok) pass++; else fail++;
}

console.log('\n=== 汇总 ===');
console.log(`通过: ${pass}/${results.length}`);

if (fail > 0) {
  console.log(`\n有 ${fail} 项失败。常见的修复方法：`);
  console.log('  - 3a plugin 用户级未装: git clone git@github.com:Ybqac/design-to-code.git ~/.gemini/config/plugins/design-to-code');
  console.log('  - 3c GEMINI.md 未追加约束: 手动把 templates/gemini-md-fragment.md 内容追加到 ~/.gemini/GEMINI.md');
  console.log('  - 4 MCP 未配: 在 ~/.gemini/config/mcp_config.json 配置你的 Figma MCP server');
  process.exit(1);
} else {
  console.log('\n整条链路通。可以正常使用 design-to-code。');
  process.exit(0);
}
