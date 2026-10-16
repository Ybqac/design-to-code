/**
 * dtc-bridge overlay —— 常驻诊断面板（f2c 式架构）。
 *
 * 关键设计（与 figma.showUI 弹窗的区别）：
 *  - 页面加载即出现，不等待 figma 编辑器；刷新自动重建（content script / user.js 重注入）
 *  - 无限等待注入：1s 轮询 window.figma（无超时上限），就绪即调 window.__dtcRunPayload()
 *  - 无限重连：WS 断线指数退避（1s 起、封顶 30s、无次数上限，成功清零）——relay 重启自动恢复
 *  - 命令通路：WS ⇄ window.postMessage（dtc-bridge 命名空间）⇄ 同页 payload（code.js）
 *  - SPA 导航：非设计页自动折叠为胶囊；可手动折叠（localStorage 记忆）
 */
(function () {
  if (window.__dtcOverlayLoaded) return;
  window.__dtcOverlayLoaded = true;

  var LS = {
    get: function (k, d) { try { return localStorage.getItem(k) || d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  };

  // ---- 样式 ----
  var STYLE_ID = "dtc-bridge-overlay-style";
  if (!document.getElementById(STYLE_ID)) {
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      "#dtc-bridge-overlay{position:fixed;top:16px;right:16px;z-index:2147483646;width:340px;",
      "background:#1e1e1e;color:#d4d4d4;border:1px solid #333;border-radius:10px;",
      "box-shadow:0 8px 28px rgba(0,0,0,.45);font:12px/1.5 -apple-system,'PingFang SC',sans-serif;",
      "display:flex;flex-direction:column;overflow:hidden;}",
      "#dtc-bridge-overlay *{margin:0;padding:0;box-sizing:border-box;}",
      "#dtc-bridge-overlay.folded{width:auto;}",
      "#dtc-bridge-overlay .hdr{padding:9px 12px;border-bottom:1px solid #333;display:flex;align-items:center;gap:8px;flex-wrap:wrap;}",
      "#dtc-bridge-overlay .dot{width:9px;height:9px;border-radius:50%;background:#6b7280;flex:none;}",
      "#dtc-bridge-overlay .dot.ok{background:#22c55e;box-shadow:0 0 6px #22c55e88;}",
      "#dtc-bridge-overlay .dot.warn{background:#f59e0b;}",
      "#dtc-bridge-overlay .dot.err{background:#ef4444;}",
      "#dtc-bridge-overlay #dtc-status{font-weight:600;color:#e5e7eb;}",
      "#dtc-bridge-overlay #dtc-inject{color:#9ca3af;font-size:11px;}",
      "#dtc-bridge-overlay .fold-btn{margin-left:auto;background:none;border:none;color:#9ca3af;cursor:pointer;font-size:14px;padding:0 4px;}",
      "#dtc-bridge-overlay .fold-btn:hover{color:#fff;}",
      "#dtc-bridge-overlay .fields{display:flex;gap:6px;margin-left:auto;}",
      "#dtc-bridge-overlay .fields label{display:flex;align-items:center;gap:4px;color:#9ca3af;font-size:11px;}",
      "#dtc-bridge-overlay .fields input{width:52px;background:#2d2d2d;color:#e0e0e0;border:1px solid #444;border-radius:4px;padding:2px 6px;font:11px ui-monospace,monospace;}",
      "#dtc-bridge-overlay .fields input#dtc-channel{width:64px;}",
      "#dtc-bridge-overlay .stats{padding:5px 12px;border-bottom:1px solid #333;color:#9ca3af;display:flex;gap:14px;font-size:11px;}",
      "#dtc-bridge-overlay .stats b{color:#d1d5db;font-weight:600;}",
      "#dtc-bridge-overlay .sel-box{border-bottom:1px solid #333;padding:6px 12px 8px;}",
      "#dtc-bridge-overlay .sel-head{display:flex;align-items:center;gap:8px;color:#9ca3af;font-size:11px;margin-bottom:4px;}",
      "#dtc-bridge-overlay .sel-head .n{color:#d1d5db;font-weight:600;}",
      "#dtc-bridge-overlay .sel-head button{margin-left:auto;}",
      "#dtc-bridge-overlay #dtc-sel-list{display:flex;flex-direction:column;gap:3px;}",
      "#dtc-bridge-overlay .sel-node{display:flex;align-items:center;gap:6px;padding:3px 6px;background:#232323;border:1px solid #333;border-radius:6px;cursor:pointer;}",
      "#dtc-bridge-overlay .sel-node:hover{border-color:#2563eb;}",
      "#dtc-bridge-overlay .sel-node .nm{color:#e5e7eb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:44%;}",
      "#dtc-bridge-overlay .sel-node .ty{color:#6b7280;font-size:10px;flex:none;}",
      "#dtc-bridge-overlay .sel-node .id{color:#60a5fa;font:10px ui-monospace,monospace;margin-left:auto;flex:none;}",
      "#dtc-bridge-overlay .sel-node .sz{color:#6b7280;font-size:10px;flex:none;}",
      "#dtc-bridge-overlay .sel-empty{color:#6b7280;font-size:11px;padding:2px 0;}",
      "#dtc-bridge-overlay #dtc-log{height:180px;overflow-y:auto;padding:8px 10px;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:#171717;}",
      "#dtc-bridge-overlay .ln{white-space:pre-wrap;word-break:break-all;}",
      "#dtc-bridge-overlay .ln .t{color:#525252;margin-right:6px;}",
      "#dtc-bridge-overlay .ln.info .m{color:#9ca3af;}",
      "#dtc-bridge-overlay .ln.ok .m{color:#4ade80;}",
      "#dtc-bridge-overlay .ln.cmd .m{color:#60a5fa;}",
      "#dtc-bridge-overlay .ln.res .m{color:#a78bfa;}",
      "#dtc-bridge-overlay .ln.err .m{color:#f87171;}",
      "#dtc-bridge-overlay .ln.prog .m{color:#d97706;}",
      "#dtc-bridge-overlay .foot{padding:8px 12px;border-top:1px solid #333;display:flex;gap:8px;}",
      "#dtc-bridge-overlay button{background:#2d2d2d;color:#d4d4d4;border:1px solid #444;border-radius:6px;padding:4px 10px;font:11px -apple-system,'PingFang SC',sans-serif;cursor:pointer;}",
      "#dtc-bridge-overlay button:hover{background:#3a3a3a;}",
      "#dtc-bridge-overlay button.primary{background:#2563eb;border-color:#2563eb;color:#fff;}",
      "#dtc-bridge-overlay button.primary:hover{background:#1d4ed8;}",
      "#dtc-bridge-overlay .pill{padding:7px 12px;display:flex;align-items:center;gap:8px;cursor:pointer;}",
      "#dtc-bridge-overlay.folded .full{display:none;}",
      "#dtc-bridge-overlay:not(.folded) .pill{display:none;}",
    ].join("");
    (document.head || document.documentElement).appendChild(style);
  }

  // ---- DOM ----
  var root = document.createElement("div");
  root.id = "dtc-bridge-overlay";
  root.innerHTML = [
    '<div class="pill"><span class="dot" id="dtc-dot"></span><span id="dtc-pill-text">dtc</span></div>',
    '<div class="full">',
    '  <div class="hdr">',
    '    <span class="dot" id="dtc-dot2"></span><span id="dtc-status">初始化…</span><span id="dtc-inject">等待编辑器…</span>',
    '    <div class="fields">',
    '      <label>ch <input id="dtc-channel" title="channel，与 dtc extract --channel 一致，回车生效"></label>',
    '      <label>port <input id="dtc-port" title="relay 端口，回车生效"></label>',
    '    </div>',
    '    <button class="fold-btn" id="dtc-fold" title="折叠">—</button>',
    '  </div>',
    '  <div class="stats"><span>收 <b id="dtc-in">0</b></span><span>发 <b id="dtc-out">0</b></span><span>最近 <b id="dtc-last">-</b></span></div>',
    '  <div class="sel-box">',
    '    <div class="sel-head"><span>当前选中 <span class="n" id="dtc-sel-n">0</span> 个</span><button id="dtc-copy-cmd">复制提取命令</button></div>',
    '    <div id="dtc-sel-list"><div class="sel-empty">（未选中节点）在 Figma 里点选图层后此处实时更新</div></div>',
    '  </div>',
    '  <div id="dtc-log"></div>',
    '  <div class="foot">',
    '    <button id="dtc-toggle" class="primary">重连</button><button id="dtc-copy">复制诊断</button><button id="dtc-clear">清空</button>',
    '  </div>',
    '</div>',
  ].join("");
  (document.body || document.documentElement).appendChild(root);

  var $ = function (id) { return document.getElementById(id); };
  var channelInput = $("dtc-channel");
  var portInput = $("dtc-port");
  // channel 规范化：小写、去非法字符、限长——防误粘贴整句话进 channel（曾把报错文案存成 channel 名）
  function sanitizeChannel(v) {
    return String(v == null ? "" : v).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 24);
  }
  function currentChannel() {
    return sanitizeChannel(channelInput.value) || "dtc";
  }
  channelInput.value = sanitizeChannel(LS.get("dtc:channel", "dtc")) || "dtc";
  portInput.value = LS.get("dtc:uiPort", "3055");

  // ---- 状态与日志 ----
  var state = {
    socket: null, connected: false, manualStop: false, retry: 0, retryTimer: null,
    inCount: 0, outCount: 0, pending: new Map(), logs: [], injected: false, lastSel: [],
  };
  var LOG_MAX = 200;
  var logEl = $("dtc-log");
  function log(type, msg) {
    var time = new Date().toTimeString().slice(0, 8);
    state.logs.push({ t: time, type: type, m: String(msg) });
    if (state.logs.length > LOG_MAX) state.logs.shift();
    var div = document.createElement("div");
    div.className = "ln " + type;
    var t = document.createElement("span"); t.className = "t"; t.textContent = time;
    var m = document.createElement("span"); m.className = "m"; m.textContent = msg;
    div.appendChild(t); div.appendChild(m);
    logEl.appendChild(div);
    while (logEl.children.length > LOG_MAX) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  function setStatus(cls, text) {
    $("dtc-dot").className = "dot " + cls;
    $("dtc-dot2").className = "dot " + cls;
    $("dtc-status").textContent = text;
    var ch = currentChannel();
    var chDisp = ch.length > 12 ? ch.slice(0, 12) + "…" : ch;
    $("dtc-pill-text").textContent = cls === "ok" ? "dtc · " + chDisp : "dtc " + text;
  }
  function setInject(text, cls) {
    var el = $("dtc-inject");
    el.textContent = text;
    el.style.color = cls === "ok" ? "#4ade80" : cls === "err" ? "#f87171" : "#9ca3af";
  }
  function bump() { $("dtc-in").textContent = state.inCount; $("dtc-out").textContent = state.outCount; }

  // ---- WS：无限退避重连（1s 起、封顶 30s、无次数上限） ----
  function connect() {
    if (state.socket) return;
    var port = parseInt(portInput.value, 10) || 3055;
    var channel = currentChannel();
    channelInput.value = channel;
    LS.set("dtc:uiPort", String(port));
    LS.set("dtc:channel", channel);
    setStatus("warn", "连接中…");
    log("info", "连接 ws://localhost:" + port + "（channel " + channel + "）");
    var ws;
    try { ws = new WebSocket("ws://localhost:" + port); }
    catch (e) { log("err", "WebSocket 创建失败: " + e.message); return scheduleReconnect(); }
    state.socket = ws;
    ws.onopen = function () { ws.send(JSON.stringify({ type: "join", channel: channel })); };
    ws.onmessage = function (ev) {
      var data;
      try { data = JSON.parse(ev.data); } catch (e) { return; }
      var msg = data.message || {};
      if (data.type === "system") {
        if (msg && typeof msg === "object" && msg.result) {
          state.connected = true; state.retry = 0;
          setStatus("ok", "已连接 · " + channel);
          log("ok", "已加入 channel " + channel + "（relay 就绪，等 dtc 命令）");
        } else if (typeof msg === "string") {
          log("info", "relay: " + msg);
        }
        return;
      }
      if (data.type === "error") { log("err", "relay 错误: " + (typeof msg === "string" ? msg : JSON.stringify(msg))); return; }
      if (data.type === "progress_update") return;
      if (msg && msg.command) {
        state.inCount++; bump();
        state.pending.set(msg.id, msg.command);
        $("dtc-last").textContent = msg.command;
        log("cmd", "→ " + msg.command + " " + JSON.stringify(msg.params || {}).slice(0, 100));
        // 经 window 通道分发给同页 payload（code.js 的 dtc-bridge 监听器）
        window.postMessage({ source: "dtc-bridge", dir: "to-sandbox", type: "execute-command", id: msg.id || data.id, command: msg.command, params: msg.params }, "*");
      }
    };
    ws.onclose = function () {
      state.socket = null;
      if (state.connected) log("err", "连接断开");
      state.connected = false;
      if (!state.manualStop) scheduleReconnect();
      else setStatus("err", "已断开（手动）");
    };
    ws.onerror = function () {};
  }
  function scheduleReconnect() {
    state.retry += 1;
    var delay = Math.min(30000, 1000 * Math.pow(1.6, state.retry - 1));
    setStatus("warn", "重连中 · 第 " + state.retry + " 次（" + Math.round(delay / 1000) + "s 后）");
    log("info", "重连中 · 第 " + state.retry + " 次（relay 未启动？bun socket）");
    clearTimeout(state.retryTimer);
    state.retryTimer = setTimeout(connect, delay);
  }

  // ---- payload 侧回流（code.js 广播的 figma.ui.postMessage 镜像） ----
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || d.source !== "dtc-bridge" || d.dir !== "ui") return;
    var pm = d.msg || {};
    if (pm.type === "command-result") {
      state.outCount++; bump();
      var cmd = state.pending.get(pm.id) || "?";
      state.pending.delete(pm.id);
      log("res", "← " + cmd + " OK " + JSON.stringify(pm.result || {}).slice(0, 80));
      sendToRelay({ id: pm.id, result: pm.result || {} });
    } else if (pm.type === "command-error") {
      state.outCount++; bump();
      var cmd2 = state.pending.get(pm.id) || "?";
      state.pending.delete(pm.id);
      log("err", "← " + cmd2 + " 失败: " + pm.error);
      sendToRelay({ id: pm.id, result: {}, error: pm.error });
    } else if (pm.type === "selection") {
      renderSelection(pm.nodes || []);
    } else if (pm.type === "command_progress") {
      if (pm.status === "started" || pm.status === "completed" || pm.status === "error") {
        log("prog", "⏳ " + (pm.commandType || "") + " " + pm.status + (pm.message ? " — " + pm.message : ""));
      }
    } else if (pm.type === "notify") {
      log("info", "插件: " + (pm.message || ""));
    }
  });
  function sendToRelay(message) {
    if (state.socket && state.socket.readyState === 1) {
      state.socket.send(JSON.stringify({ id: message.id, type: "message", channel: currentChannel(), message: message }));
    } else {
      log("err", "无法回结果（relay 未连接）: " + JSON.stringify(message).slice(0, 60));
    }
  }

  // ---- 选区显示 ----
  function idToCmd(id) { return "dtc extract --node " + id.replace(":", "-"); }
  function copyText(text, okMsg) {
    function done(ok) { log(ok ? "ok" : "err", ok ? okMsg : "复制失败"); }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true); }, function () { fallback(); });
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement("textarea");
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { done(document.execCommand("copy")); } catch (e) { done(false); }
      document.body.removeChild(ta);
    }
  }
  var lastSelKey = "";
  function renderSelection(nodes) {
    state.lastSel = nodes || [];
    $("dtc-sel-n").textContent = String(state.lastSel.length);
    var key = state.lastSel.map(function (n) { return n.id; }).join(",");
    if (key !== lastSelKey) {
      lastSelKey = key;
      if (state.lastSel.length) {
        log("info", "选中 " + state.lastSel.length + " 个: " + state.lastSel.slice(0, 3).map(function (n) { return n.name + "(" + n.id + ")"; }).join(", ") + (state.lastSel.length > 3 ? " …" : ""));
      }
    }
    var list = $("dtc-sel-list");
    list.innerHTML = "";
    if (!state.lastSel.length) {
      var emp = document.createElement("div");
      emp.className = "sel-empty";
      emp.textContent = "（未选中节点）在 Figma 里点选图层后此处实时更新";
      list.appendChild(emp);
      return;
    }
    state.lastSel.forEach(function (n) {
      var row = document.createElement("div");
      row.className = "sel-node";
      row.title = "点击复制 nodeId：" + n.id;
      function span(cls, text) { var s = document.createElement("span"); s.className = cls; s.textContent = text; return s; }
      row.appendChild(span("nm", n.name || "(未命名)"));
      row.appendChild(span("ty", n.type || ""));
      row.appendChild(span("sz", n.width ? Math.round(n.width) + "×" + Math.round(n.height) : ""));
      row.appendChild(span("id", n.id));
      row.onclick = function () { copyText(n.id, "已复制 nodeId " + n.id); };
      list.appendChild(row);
    });
  }

  // ---- 无限等待注入：1s 轮询 figma.currentPage（f2c waitForFigma 同款就绪条件，无上限） ----
  var waitingLogged = false;
  setInterval(function () {
    if (state.injected) return;
    var has = typeof figma !== "undefined" && figma;
    var ready = has && !!figma.currentPage;
    if (ready && typeof window.__dtcRunPayload === "function") {
      state.injected = true;
      try {
        window.__dtcRunPayload();
        setInject("已注入 ✓", "ok");
        log("ok", "payload 已注入（figma 编辑器就绪）");
        readSelectionFromFigma();
        setTimeout(readSelectionFromFigma, 1500);
      } catch (e) {
        state.injected = false;
        setInject("注入失败：" + (e && e.message), "err");
        log("err", "payload 注入失败: " + (e && e.message));
      }
      return;
    }
    if (!waitingLogged) { waitingLogged = true; log("info", "等待 Figma 编辑器（1s 轮询，无超时）…"); }
    setInject(has ? "figma 在但未就绪…" : "等待编辑器…", "");
  }, 1000);

  // ---- 选区 DOM 检测（f2c 方案）：画布/图层面板 click + keydown → debounce 后读 figma.currentPage.selection ----
  // 页面级 window.figma 的 selectionchange 事件不触发（f2c 源码佐证），必须走 DOM 事件
  var selTimer = null;
  function readSelectionFromFigma() {
    try {
      var f = typeof figma !== "undefined" && figma;
      if (!f || !f.currentPage) return;
      var sel = (f.currentPage.selection || []).map(function (n) {
        var bb = null;
        try { bb = n.absoluteBoundingBox || null; } catch (e) {}
        return { id: n.id, name: n.name, type: n.type, width: bb ? bb.width : null, height: bb ? bb.height : null };
      });
      renderSelection(sel);
    } catch (e) { /* 编辑器切换瞬间可能读不到，忽略 */ }
  }
  function scheduleSelRead() {
    clearTimeout(selTimer);
    selTimer = setTimeout(readSelectionFromFigma, 400);
  }
  document.addEventListener("click", function (e) {
    if (root.contains(e.target)) return;
    var t = e.target;
    if (t && t.closest && (t.closest("#fullscreen-root .gpu-view-content") || t.closest("#left-panel-container"))) {
      scheduleSelRead();
    }
  }, true);
  document.addEventListener("keydown", function (e) {
    if (root.contains(e.target)) return;
    scheduleSelRead();
  }, true);

  // ---- 折叠 / SPA 导航 ----
  function applyFold(folded) { root.classList.toggle("folded", !!folded); LS.set("dtc:folded", folded ? "1" : "0"); }
  $("dtc-fold").onclick = function () { applyFold(true); };
  root.querySelector(".pill").onclick = function () { applyFold(false); };
  applyFold(LS.get("dtc:folded", "0") === "1");
  var DESIGN_RE = /figma\.com\/(design|file|board|proto)\//;
  setInterval(function () {
    if (!DESIGN_RE.test(location.href)) {
      if (!root.classList.contains("folded") && LS.get("dtc:folded", "0") !== "1") applyFold(true);
      $("dtc-pill-text").textContent = "dtc（非设计页）";
    }
  }, 2000);

  // ---- 按钮 ----
  var btnToggle = $("dtc-toggle");
  function refreshToggle() { btnToggle.textContent = state.connected ? "断开" : "重连"; }
  btnToggle.onclick = function () {
    if (state.connected) {
      state.manualStop = true; clearTimeout(state.retryTimer);
      if (state.socket) state.socket.close();
      state.socket = null;
    } else {
      state.manualStop = false; state.retry = 0; clearTimeout(state.retryTimer); connect();
    }
  };
  setInterval(refreshToggle, 1000);
  $("dtc-clear").onclick = function () { state.logs = []; logEl.innerHTML = ""; };
  $("dtc-copy-cmd").onclick = function () {
    if (!state.lastSel.length) { log("err", "没有选中节点，先在 Figma 里选一个"); return; }
    copyText(idToCmd(state.lastSel[0].id), "已复制: " + idToCmd(state.lastSel[0].id));
  };
  $("dtc-copy").onclick = function () {
    var text = [
      "# dtc-bridge 诊断",
      "# url: " + location.href,
      "# 状态: connected=" + state.connected + " retry=" + state.retry + " injected=" + state.injected + " channel=" + channelInput.value + " port=" + portInput.value,
      "# 收=" + state.inCount + " 发=" + state.outCount,
      "--- 日志 ---",
    ].concat(state.logs.map(function (l) { return l.t + " [" + l.type + "] " + l.m; })).join("\n");
    copyText(text, "诊断已复制到剪贴板");
  };
  [channelInput, portInput].forEach(function (inp) {
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        var raw = channelInput.value;
        var sanitized = currentChannel();
        if (raw !== sanitized) {
          log("err", "channel 含非法字符/过长，已规范化为 \"" + sanitized + "\"（仅小写字母/数字/-/_，≤24 字符）");
          channelInput.value = sanitized;
        }
        log("info", "参数变更 → 重连（channel " + sanitized + ", port " + portInput.value + "）");
        state.manualStop = true; clearTimeout(state.retryTimer);
        if (state.socket) state.socket.close();
        state.socket = null;
        state.manualStop = false; state.retry = 0; connect();
      }
    });
  });

  // ---- 页面级错误兜底 ----
  window.addEventListener("error", function (e) {
    console.error("[dtc-bridge] 页面错误:", e.message, e.filename ? "(" + e.filename + ":" + e.lineno + ")" : "");
  });
  window.addEventListener("unhandledrejection", function (e) {
    console.error("[dtc-bridge] 未处理的 Promise 拒绝:", e.reason);
  });

  // ---- 启动 ----
  log("info", "dtc overlay 面板就绪（常驻：等待注入 1s 轮询 / relay 无限退避重连）");
  connect();
})();
