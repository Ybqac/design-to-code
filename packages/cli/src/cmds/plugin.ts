/**
 * dtc plugin —— 通道打包：单一源码（plugin/src）构建三种长期可安装形态。
 *
 *  1. desktop/        Figma 桌面 App 开发插件（Import from manifest，一次导入永久用）
 *  2. dtc-bridge.user.js   浏览器用户脚本（Tampermonkey 拖入即装；figma.com 自动注入、
 *                     自动连 relay、自动重连、channel 固定、状态角标自诊断）
 *  3. dtc-bridge.bookmarklet.html  书签栏拖拽版（零扩展依赖，点一下即注入）
 *
 * 三形态与 console 粘贴版共享同一份增强代码（富字段 filterFigmaNode + SVG 导出）。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface PluginOptions {
  src?: string;
  dist?: string;
}

const VERSION = "0.1.0";

/** 自动重连版桥接 UI（console-injection shim 的升级：固定 channel + 指数退避重连） */
function bridgeUiHtml(): string {
  return `<!DOCTYPE html><html><body><script>
(function () {
  var CHANNEL = "dtc";
  try { CHANNEL = localStorage.getItem("dtc:channel") || CHANNEL; } catch (e) {}
  var socket = null, retry = 0;
  function connect() {
    try { socket = new WebSocket("ws://localhost:3055"); } catch (e) { return schedule(); }
    socket.onopen = function () {
      retry = 0;
      socket.send(JSON.stringify({ type: "join", channel: CHANNEL }));
    };
    socket.onmessage = function (e) {
      try {
        var data = JSON.parse(e.data);
        var msg = data.message || data;
        if (msg && msg.command) {
          parent.postMessage({ pluginMessage: { type: "execute-command", id: msg.id || data.id, command: msg.command, params: msg.params } }, "*");
        }
      } catch (err) {}
    };
    socket.onclose = function () { schedule(); };
    socket.onerror = function () {};
  }
  function schedule() {
    var delay = Math.min(30000, 2000 * Math.pow(1.5, retry++));
    setTimeout(connect, delay);
  }
  window.onmessage = function (e) {
    if (e.data && e.data.pluginMessage) {
      var m = e.data.pluginMessage;
      if (m.type === "command-result" || m.type === "command-error") {
        if (socket && socket.readyState === 1) {
          socket.send(JSON.stringify({ id: m.id, type: "message", channel: CHANNEL, message: { id: m.id, result: m.result || {}, error: m.error } }));
        }
      }
    }
  };
  connect();
})();
</script></body></html>`;
}

function userscriptHeader(): string {
  return `// ==UserScript==
// @name         Design-to-Code Bridge (dtc)
// @namespace    https://github.com/Ybqac/design-to-code
// @version      ${VERSION}
// @description  Figma ↔ 本地 dtc CLI 通道：自动注入增强插件（富字段提取 + SVG 导出），channel 默认 dtc，断线自动重连
// @author       design-to-code (fork of grab/cursor-talk-to-figma-mcp, MIT)
// @match        https://www.figma.com/file/*
// @match        https://www.figma.com/design/*
// @match        https://www.figma.com/board/*
// @match        https://www.figma.com/proto/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==`;
}

export async function runPlugin(action: string, opts: PluginOptions): Promise<void> {
  const repoRoot = path.resolve(fileURLToPath(import.meta.url), "../../../..");
  const srcDir = path.resolve(opts.src ?? path.join(repoRoot, "plugin", "src"));
  const distDir = path.resolve(opts.dist ?? path.join(repoRoot, "plugin", "build"));

  const codeJs = fs.readFileSync(path.join(srcDir, "code.js"), "utf8");
  const uiHtml = fs.readFileSync(path.join(srcDir, "ui.html"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, "manifest.json"), "utf8"));

  if (action === "build") {
    // 1. desktop 插件包（原样三件套）
    const desktopDir = path.join(distDir, "desktop");
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.copyFileSync(path.join(srcDir, "code.js"), path.join(desktopDir, "code.js"));
    fs.copyFileSync(path.join(srcDir, "ui.html"), path.join(desktopDir, "ui.html"));
    fs.copyFileSync(path.join(srcDir, "manifest.json"), path.join(desktopDir, "manifest.json"));

    // 2. .user.js（payload = __html__ shim + code.js 全文）
    const payload = `var __html__ = ${JSON.stringify(bridgeUiHtml())};\n${codeJs}`;
    const userJs = `${userscriptHeader()}
(function () {
  "use strict";
  if (window.__dtcBridgeLoaded) return;
  window.__dtcBridgeLoaded = true;

  var badge = document.createElement("div");
  badge.style.cssText = "position:fixed;top:12px;right:12px;z-index:2147483647;padding:6px 10px;border-radius:8px;font:12px/1.4 -apple-system,sans-serif;color:#fff;background:#6b7280;box-shadow:0 2px 8px rgba(0,0,0,.3);cursor:pointer;";
  badge.title = "点击切换 channel（当前 localStorage dtc:channel）";
  badge.onclick = function () {
    var next = prompt("dtc bridge channel：", localStorage.getItem("dtc:channel") || "dtc");
    if (next) { localStorage.setItem("dtc:channel", next.trim()); location.reload(); }
  };
  function setBadge(text, color) { badge.textContent = text; badge.style.background = color; }
  (document.body || document.documentElement).appendChild(badge);
  setBadge("dtc: 检测中…", "#6b7280");

  if (typeof figma === "undefined" || !figma || typeof figma.showUI !== "function") {
    setBadge("dtc: ❌ 页面无 figma 对象", "#ef4444");
    console.error("[dtc-bridge] 当前页面上下文没有 figma 插件全局对象。请确认已打开具体设计文件（figma.com/design/...）后刷新；若仍失败，改用桌面 App 开发插件或参考 plugin/build/web/README.md。");
    return;
  }
  try {
${payload
  .split("\n")
  .map((l) => "    " + l)
  .join("\n")}
    setBadge("dtc: ✅ channel " + ((localStorage.getItem("dtc:channel") || "dtc")) + " 已就绪", "#22c55e");
    console.log("[dtc-bridge] 注入完成：channel=" + (localStorage.getItem("dtc:channel") || "dtc") + "，relay=ws://localhost:3055（先 bun socket）");
  } catch (e) {
    setBadge("dtc: ❌ 注入失败 " + (e && e.message), "#ef4444");
    console.error("[dtc-bridge] 注入失败:", e);
  }
})();
`;
    const webDir = path.join(distDir, "web");
    fs.mkdirSync(webDir, { recursive: true });
    fs.writeFileSync(path.join(webDir, "dtc-bridge.user.js"), userJs);

    // 3. bookmarklet 页面（payload 打进 javascript: URL，拖到书签栏即用）
    const bookmarklet = `javascript:${encodeURIComponent(`(function(){if(window.__dtcBridgeLoaded)return;window.__dtcBridgeLoaded=true;${payload.replace(/\/\/[^\n]*/g, "")}})();`)}void 0;`;
    const bmPage = `<!DOCTYPE html>
<html lang="zh">
<head><meta charset="utf-8"><title>dtc bridge 书签安装</title>
<style>body{font:15px/1.7 -apple-system,sans-serif;max-width:720px;margin:48px auto;padding:0 20px;color:#111}
a.bookmark{display:inline-block;padding:12px 20px;background:#2563eb;color:#fff;border-radius:10px;text-decoration:none;font-weight:600}
code{background:#f1f5f9;padding:2px 6px;border-radius:4px}</style>
</head>
<body>
<h1>dtc bridge · 书签栏安装</h1>
<ol>
  <li>把下面这个按钮<strong>拖到浏览器的书签栏</strong>：</li>
  <p><a class="bookmark" href="${bookmarklet}">▶ dtc bridge</a></p>
  <li>打开 figma.com 的设计文件页面，点一下书签栏里的「dtc bridge」即完成注入（channel 默认 <code>dtc</code>，连 <code>ws://localhost:3055</code>）。</li>
  <li>每次刷新页面后需要再点一次（书签版不自动注入；想要全自动请用 <code>dtc-bridge.user.js</code> 用户脚本版）。</li>
</ol>
<h2>验证</h2>
<p>终端运行 <code>dtc doctor</code>——relay 与插件都 ✅ 即通道就绪。</p>
</body>
</html>
`;
    fs.writeFileSync(path.join(webDir, "dtc-bridge.bookmarklet.html"), bmPage);

    // 4. web 安装说明
    fs.writeFileSync(
      path.join(webDir, "README.md"),
      `# 浏览器通道安装（装一次，长期用）

## 首选：用户脚本（全自动）
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展（一次）。
2. 把 \`dtc-bridge.user.js\` **拖入浏览器窗口**（或 Tampermonkey 面板 → 添加新脚本 → 粘贴全文 → 保存）。
3. 打开 figma.com 设计文件，右上角出现绿色角标 \`dtc: ✅ channel dtc 已就绪\` 即成功。
   - 角标可点击切换 channel；断线自动重连；relay 需先启动（\`bun socket\`）。
   - 红色角标「页面无 figma 对象」= 当前页面上下文不可注入（见下方机制说明）。

## 备选：书签栏（零扩展）
打开 \`dtc-bridge.bookmarklet.html\`，把「▶ dtc bridge」按钮拖到书签栏；在 Figma 页面点一下即注入（每次刷新后需重点一次）。

## 兜底链（任一档可用即满足长期使用）
1. 用户脚本（全自动，需 Tampermonkey）
2. 书签（半自动，零依赖）
3. Figma 桌面 App → Plugins → Development → Import plugin from manifest → 选 \`../desktop/manifest.json\`（一次导入永久用）
4. 发布到 Figma Community（可选，浏览器免扩展；审核周期不可控）
5. 旧式 console 粘贴（应急，见 docs/ 附录）

## 注入机制说明（重要）
浏览器页面上下文是否存在 \`figma\` 插件全局对象由 Figma web 端决定。历史上 console 粘贴
\`console-injection.js\` 可用（本仓库实测），用户脚本以相同上下文注入，理论等价；但 Figma
前端变更可能使其失效。角标自诊断会明确提示；失效时走兜底链 3（桌面 App 插件——
不依赖该机制，长期最稳）。
`,
    );

    console.log(`✅ plugin build → ${distDir}/`);
    console.log(`   desktop/            Figma 桌面 App：Plugins → Development → Import plugin from manifest`);
    console.log(`   web/dtc-bridge.user.js        浏览器拖入即装（Tampermonkey，全自动注入+重连）`);
    console.log(`   web/dtc-bridge.bookmarklet.html 书签栏版（零扩展，点一下注入）`);
    console.log(`   web/README.md       安装与机制说明`);
  } else if (action === "install") {
    // install = 打包（若未构建）+ 打印安装指引
    if (!fs.existsSync(path.join(distDir, "web", "dtc-bridge.user.js"))) {
      await runPlugin("build", opts);
    }
    console.log(`
📦 安装指引（channel 默认 dtc，与 dtc extract --channel 一致）

[浏览器·首选] 用户脚本
  1. 装 Tampermonkey 扩展（如未有）
  2. 把 ${path.join(distDir, "web", "dtc-bridge.user.js")} 拖入浏览器窗口
  3. 打开 Figma 设计文件 → 右上角绿色角标即就绪

[浏览器·零扩展] 书签
  1. 用浏览器打开 ${path.join(distDir, "web", "dtc-bridge.bookmarklet.html")}
  2. 把「▶ dtc bridge」拖到书签栏；Figma 页面里点一下

[桌面 App·最稳]
  Figma 桌面 App → Plugins → Development → Import plugin from manifest
  → 选择 ${path.join(distDir, "desktop", "manifest.json")}
  （一次导入永久存在；浏览器版失效时的兜底）

前置：relay 需运行 —— 在 ~/code/cursor-talk-to-figma-mcp 下执行 bun socket
验证：dtc doctor（relay + 插件双 ✅）
插件名：${manifest.name}
`);
  } else {
    throw new Error(`未知 action: ${action}（支持 build | install）`);
  }
}
