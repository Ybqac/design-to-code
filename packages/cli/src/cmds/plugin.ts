/**
 * dtc plugin —— 通道打包：单一源码（plugin/src）构建四种长期可安装形态。
 *
 *  1. desktop/        Figma 桌面 App 开发插件（Import from manifest，一次导入永久用）
 *  2. chrome-extension/ + dtc-bridge-chrome-extension.zip  Chromium 扩展（MV3，content
 *                     script 注入 MAIN world；扩展页拖入/加载已解压，无需 Tampermonkey）
 *  3. web/dtc-bridge.user.js   浏览器用户脚本（Tampermonkey 拖入即装）
 *  4. web/dtc-bridge.bookmarklet.html  书签栏拖拽版（零扩展依赖，点一下即注入）
 *
 * 各形态与 console 粘贴版共享同一份增强代码（富字段 filterFigmaNode + SVG 导出）。
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
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

    // 2. 桥接注入体（.user.js 与 chrome 扩展共用）
    const payload = `var __html__ = ${JSON.stringify(bridgeUiHtml())};\n${codeJs}`;
    const body = `(function () {
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

    // 2a. .user.js（Tampermonkey 用户脚本）
    const userJs = `${userscriptHeader()}
${body}`;
    fs.writeFileSync(path.join(webDir, "dtc-bridge.user.js"), userJs);

    // 2b. Chromium 扩展（MV3，content script 注入 MAIN world，无需 Tampermonkey；
    //     打包 zip 供"加载已解压的扩展程序/拖入扩展页"安装）
    const chromeDir = path.join(distDir, "chrome-extension");
    fs.mkdirSync(chromeDir, { recursive: true });
    fs.writeFileSync(
      path.join(chromeDir, "manifest.json"),
      JSON.stringify(
        {
          manifest_version: 3,
          name: "Design-to-Code Bridge",
          version: VERSION,
          description: "Figma ↔ dtc CLI 通道：自动注入 bridge（channel 默认 dtc，自动重连）",
          content_scripts: [
            {
              matches: [
                "https://www.figma.com/file/*",
                "https://www.figma.com/design/*",
                "https://www.figma.com/board/*",
                "https://www.figma.com/proto/*",
              ],
              js: ["content.js"],
              run_at: "document_idle",
              world: "MAIN",
              all_frames: false,
            },
          ],
        },
        null,
        2,
      ) + "\n",
    );
    fs.writeFileSync(path.join(chromeDir, "content.js"), body);
    const zipPath = path.join(distDir, "dtc-bridge-chrome-extension.zip");
    try {
      fs.rmSync(zipPath, { force: true });
      execSync(`cd ${JSON.stringify(chromeDir)} && zip -qr ${JSON.stringify(zipPath)} .`, { stdio: "pipe" });
      console.log(`→ Chrome 扩展包: ${zipPath}`);
    } catch {
      console.warn(`⚠️ 系统 zip 命令不可用，未打包 zip（${chromeDir} 目录仍可直接"加载已解压的扩展程序"）`);
    }

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

## 首选：Chromium 扩展（无需任何额外扩展管理器）
产物：\`../dtc-bridge-chrome-extension.zip\`（源目录 \`../chrome-extension/\`）
1. 解压 zip 得到 chrome-extension 文件夹。
2. 打开 \`chrome://extensions\`，开启「开发者模式」。
3. 把文件夹拖入扩展页，或点「加载已解压的扩展程序」选择该文件夹。
4. 打开 figma.com 设计文件，右上角绿色角标 \`dtc: ✅ channel dtc 已就绪\` 即成功
   （角标可点击切换 channel；断线自动重连；relay 需先启动 \`bun socket\`）。
注意：开发者模式安装的扩展，Chrome 启动时可能提示「关闭开发者模式扩展」——选择保留即可。
不需要用「打包扩展程序」按钮：它生成 .crx（商店分发格式），本地 .crx 会被 Chrome 拦截。

## 备选 1：用户脚本（Tampermonkey）
1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展（一次）。
2. 把 \`dtc-bridge.user.js\` **拖入浏览器窗口**（或 Tampermonkey 面板 → 添加新脚本 → 粘贴全文 → 保存）。

## 备选 2：书签栏（零扩展）
打开 \`dtc-bridge.bookmarklet.html\`，把「▶ dtc bridge」按钮拖到书签栏；在 Figma 页面点一下即注入（每次刷新后需重点一次）。

## 兜底链（任一档可用即满足长期使用）
1. Chromium 扩展（chrome://extensions 加载已解压 / 拖 zip）
2. 用户脚本（Tampermonkey）
3. 书签（零依赖，手动点击）
4. Figma 桌面 App → Plugins → Development → Import plugin from manifest → 选 \`../desktop/manifest.json\`（一次导入永久用，不依赖页面注入机制，长期最稳）
5. 旧式 console 粘贴（应急，见 docs/ 附录）

## 注入机制说明（重要）
浏览器页面上下文是否存在 \`figma\` 插件全局对象由 Figma web 端决定。历史上 console 粘贴
\`console-injection.js\` 可用（本仓库实测），扩展/用户脚本以相同上下文注入，理论等价；但 Figma
前端变更可能使其失效。角标自诊断会明确提示；失效时走兜底链 4（桌面 App 插件）。
`,
    );

    console.log(`✅ plugin build → ${distDir}/`);
    console.log(`   desktop/                          Figma 桌面 App：Plugins → Development → Import plugin from manifest`);
    console.log(`   dtc-bridge-chrome-extension.zip   Chromium 扩展：chrome://extensions 开发者模式 → 拖入/加载已解压`);
    console.log(`   web/dtc-bridge.user.js            用户脚本（Tampermonkey 拖入即装）`);
    console.log(`   web/dtc-bridge.bookmarklet.html   书签栏版（零扩展，点一下注入）`);
    console.log(`   web/README.md                     安装与机制说明`);
  } else if (action === "install") {
    // install = 打包（若未构建）+ 打印安装指引
    if (!fs.existsSync(path.join(distDir, "web", "dtc-bridge.user.js"))) {
      await runPlugin("build", opts);
    }
    const zipPath = path.join(distDir, "dtc-bridge-chrome-extension.zip");
    console.log(`
📦 安装指引（channel 默认 dtc，与 dtc extract --channel 一致）

[浏览器·首选] Chromium 扩展（无需 Tampermonkey）
  1. 解压 ${zipPath} 得到 chrome-extension 文件夹
  2. 打开 chrome://extensions，开「开发者模式」
  3. 把文件夹拖入扩展页（或点「加载已解压的扩展程序」选择它）
  4. 打开 Figma 设计文件 → 右上角绿色角标即就绪
     （Chrome 启动提示"关闭开发者模式扩展"时选择保留）

[浏览器·备选] 用户脚本 / 书签
  Tampermonkey 装好后拖入 ${path.join(distDir, "web", "dtc-bridge.user.js")}；
  或打开 ${path.join(distDir, "web", "dtc-bridge.bookmarklet.html")} 拖书签

[桌面 App·最稳] 不依赖页面注入机制
  Figma 桌面 App → Plugins → Development → Import plugin from manifest
  → 选择 ${path.join(distDir, "desktop", "manifest.json")}（一次导入永久存在）

前置：relay 需运行 —— 在 ~/code/cursor-talk-to-figma-mcp 下执行 bun socket
验证：dtc doctor（relay + 插件双 ✅）
插件名：${manifest.name}
`);
  } else {
    throw new Error(`未知 action: ${action}（支持 build | install）`);
  }
}
