import { handleCommand } from "./commands/registry.js";
import { state } from "./state.js";

// This is the main code file for the Cursor MCP Figma plugin
// It handles Figma API commands

// Show UI（桌面插件：正常弹窗；浏览器 overlay 注入：不弹窗，命令走 window 直连通道，
// figma.ui/notify 只做防御性 shim——页面级 figma 上这些沙箱 API 可能缺失或只读，任何失败只告警不抛出）
// 注意：Figma 插件沙箱无 window/document，必须守卫
var __dtcOverlayMode =
  typeof window !== "undefined" && window.__dtcOverlay === true;
if (__dtcOverlayMode) {
  try {
    if (typeof figma.notify !== "function") {
      figma.notify = function (m) { console.log("[dtc-bridge] notify:", m); };
    }
  } catch (e) {
    console.warn("[dtc-bridge] figma.notify 不可用:", e && e.message);
  }
  try {
    var __dtcMirror = function (msg) {
      window.postMessage({ source: "dtc-bridge", dir: "ui", msg: msg }, window.origin || "*");
    };
    if (!figma.ui || typeof figma.ui.postMessage !== "function") {
      try {
        figma.ui = { postMessage: __dtcMirror, onmessage: null };
      } catch (e2) {
        Object.defineProperty(figma, "ui", {
          value: { postMessage: __dtcMirror, onmessage: null },
          configurable: true,
        });
      }
    } else {
      var __dtcOrigPost = figma.ui.postMessage.bind(figma.ui);
      figma.ui.postMessage = function (msg) {
        try { __dtcOrigPost(msg); } catch (e) {}
        __dtcMirror(msg);
      };
    }
  } catch (e) {
    console.warn("[dtc-bridge] figma.ui shim 失败（progress/notify 可能缺失，不影响命令）:", e && e.message);
  }
} else {
  figma.showUI(__html__, { width: 360, height: 540, themeColors: true });
}

// dtc 增强：上游 GA 统计已移除（全程本地，不外发数据）

// dtc 增强：选区变化推送到面板（debounce 300ms）。
// 仅桌面插件模式注册——页面级 window.figma 上 selectionchange 不触发（f2c 源码佐证，
// 浏览器 overlay 的选区由 overlay.js 的 DOM 检测负责）。
var __dtcSelTimer = null;
function __dtcPushSelection() {
  try {
    if (!figma.currentPage) return;
    var sel = (figma.currentPage.selection || []).map(function (n) {
      var bb = null;
      try { bb = n.absoluteBoundingBox || null; } catch (e) {}
      return { id: n.id, name: n.name, type: n.type, width: bb ? bb.width : null, height: bb ? bb.height : null };
    });
    figma.ui.postMessage({ type: "selection", nodes: sel });
  } catch (e) {
    console.error("dtc selection push failed:", e);
  }
}
if (!__dtcOverlayMode) {
  try {
    figma.on("selectionchange", function () {
      if (__dtcSelTimer) clearTimeout(__dtcSelTimer);
      __dtcSelTimer = setTimeout(__dtcPushSelection, 300);
    });
    setTimeout(__dtcPushSelection, 800); // 启动时同步一次当前选区
  } catch (e) {
    console.error("dtc selectionchange unavailable:", e);
  }
}

// Plugin commands from UI
figma.ui.onmessage = async (msg) => {
  switch (msg.type) {
    case "update-settings":
      updateSettings(msg);
      break;
    case "notify":
      figma.notify(msg.message);
      break;
    case "close-plugin":
      figma.closePlugin();
      break;
    case "execute-command":
      // Execute commands received from UI (which gets them from WebSocket)
      try {
        const result = await handleCommand(msg.command, msg.params);
        figma.ui.postMessage({
          type: "command-result",
          id: msg.id,
          result,
        });
      } catch (error) {
        figma.ui.postMessage({
          type: "command-error",
          id: msg.id,
          error: error.message || "Error executing command",
        });
      }
      break;
  }
};

// dtc overlay：window 消息直连通道（overlay 面板 → handleCommand → 结果原路回传）。
// 不经 figma.ui.onmessage / figma.ui.postMessage（页面级 figma 上不可靠）；
// 沙箱无 window，仅在浏览器注入环境生效。
if (typeof window !== "undefined") {
  window.addEventListener("message", async function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.source !== "dtc-bridge" || d.dir !== "to-sandbox" || d.type !== "execute-command") return;
    try {
      var result = await handleCommand(d.command, d.params);
      window.postMessage({ source: "dtc-bridge", dir: "ui", msg: { type: "command-result", id: d.id, result: result } }, window.origin || "*");
    } catch (err) {
      window.postMessage({ source: "dtc-bridge", dir: "ui", msg: { type: "command-error", id: d.id, error: (err && err.message) || "Error executing command" } }, window.origin || "*");
    }
  });
}

// Listen for plugin commands from menu（仅桌面插件模式——页面级订阅 "run" 且回调触碰
// figma.ui 是 An error occurred 报错弹窗的来源之一）
if (!__dtcOverlayMode) {
  figma.on("run", ({ command }) => {
    figma.ui.postMessage({ type: "auto-connect" });
  });
}

// Update plugin settings
function updateSettings(settings) {
  if (settings.serverPort) {
    state.serverPort = settings.serverPort;
  }

  figma.clientStorage.setAsync("settings", {
    serverPort: state.serverPort,
  });
}

// Initialize settings on load
(async function initializePlugin() {
  try {
    const savedSettings = await figma.clientStorage.getAsync("settings");
    if (savedSettings) {
      if (savedSettings.serverPort) {
        state.serverPort = savedSettings.serverPort;
      }
    }

    // Send initial settings to UI
    figma.ui.postMessage({
      type: "init-settings",
      settings: {
        serverPort: state.serverPort,
      },
    });
  } catch (error) {
    console.error("Error loading settings:", error);
  }
})();
