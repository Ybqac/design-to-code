/**
 * dtc setup —— 一条命令完成全部接入（全自动优先，只在需要人操作处停下引导）。
 *
 * 步骤：构建自检 → dtc 全局命令 → relay 自动拉起 → Cursor 全局接入（MCP + 规则文件，
 * 零手工粘贴）→ Figma 通道引导（浏览器安装扩展时轮询等待）→ chromium → doctor 汇总。
 */
import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { relayUp, runRelay } from "./relay.js";
import { FigmaRelayClient } from "../ws-client.js";
import { runDoctor } from "./doctor.js";

const execA = promisify(exec);
const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");
const CURSOR_HOME = path.join(os.homedir(), ".cursor");

export interface SetupOptions {
  yes?: boolean; // 全自动（CI）；非 TTY 自动视为 yes
  channel?: string;
}

function sh(cmd: string, cwd = REPO_ROOT): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

async function isCommand(name: string): Promise<boolean> {
  try {
    await execA(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

function step(n: number, total: number, title: string): void {
  console.log(`\n[${n}/${total}] ${title}`);
}

export async function runSetup(opts: SetupOptions): Promise<number> {
  const interactive = process.stdout.isTTY && !opts.yes;
  const channel = opts.channel ?? "dtc";
  const TOTAL = 6;
  let ok = true;

  // 1. 构建自检
  step(1, TOTAL, "构建自检");
  const needBuild = !fs.existsSync(path.join(REPO_ROOT, "packages/mcp/dist/server.js"));
  if (needBuild) {
    console.log("→ dist 缺失，执行 npm install && npm run build ...");
    sh("npm install && npm run build");
  } else {
    console.log("✅ 构建产物就绪");
  }

  // 2. dtc 全局命令
  step(2, TOTAL, "dtc 全局命令");
  if (await isCommand("dtc")) {
    console.log("✅ dtc 已在 PATH");
  } else {
    console.log("→ npm link（所有终端可用）...");
    sh("npm link", path.join(REPO_ROOT, "packages/cli"));
    console.log("✅ dtc 已全局注册（当前 shell 若不识别，重开终端即可）");
  }

  // 3. relay
  step(3, TOTAL, "relay（ws://localhost:3055）");
  if (await relayUp()) {
    console.log("✅ relay 已在运行（复用）");
  } else {
    console.log("→ 自动启动内置 relay（后台守护，日志 ~/.dtc/relay.log）...");
    const code = await runRelay("start");
    if (code !== 0) ok = false;
  }

  // 4. Cursor 全局接入（MCP + 规则文件——官方支持 ~/.cursor/rules 全局规则，零手工粘贴）
  step(4, TOTAL, "Cursor 全局接入");
  if (fs.existsSync(CURSOR_HOME)) {
    // 4a. MCP 合并
    const mcpFile = path.join(CURSOR_HOME, "mcp.json");
    let cfg: any = { mcpServers: {} };
    if (fs.existsSync(mcpFile)) {
      try {
        cfg = JSON.parse(fs.readFileSync(mcpFile, "utf8"));
      } catch {
        console.warn(`⚠️ ${mcpFile} 解析失败，跳过 MCP 注册（请手动处理）`);
        cfg = null;
      }
    }
    if (cfg) {
      cfg.mcpServers = cfg.mcpServers || {};
      cfg.mcpServers.dtc = { command: "node", args: [path.join(REPO_ROOT, "packages/mcp/dist/server.js")] };
      fs.mkdirSync(CURSOR_HOME, { recursive: true });
      fs.writeFileSync(mcpFile, JSON.stringify(cfg, null, 2) + "\n");
      console.log(`✅ MCP: dtc server → ${mcpFile}`);
    }
    // 4b. 全局规则文件
    const rulesDir = path.join(CURSOR_HOME, "rules");
    fs.mkdirSync(rulesDir, { recursive: true });
    const srcDir = path.join(REPO_ROOT, "integrations/cursor/rules-global");
    for (const f of fs.readdirSync(srcDir).filter((x) => x.endsWith(".mdc"))) {
      fs.copyFileSync(path.join(srcDir, f), path.join(rulesDir, f));
    }
    console.log(`✅ 全局规则: dtc-workflow.mdc + dtc-anti-fabrication.mdc → ${rulesDir}`);
    console.log("ℹ️  需重启 Cursor 生效（MCP 与规则在启动时加载）");
  } else {
    console.log(`⏭ 未检测到 ${CURSOR_HOME}（未安装 Cursor？），跳过——装好后重跑 dtc setup`);
  }

  // 5. Figma 通道
  step(5, TOTAL, "Figma 通道（插件/扩展连到 channel）");
  {
    const client = new FigmaRelayClient({ joinTimeoutMs: 3000 });
    let ping: Awaited<ReturnType<typeof client.ping>>;
    try {
      ping = await client.ping(channel);
    } finally {
      client.close();
    }
    if (ping.relay && ping.plugin) {
      console.log(`✅ 插件已连 channel "${channel}"`);
    } else if (!ping.relay) {
      console.log("❌ relay 不可达（上一步启动失败？）");
      ok = false;
    } else {
      console.log("→ 插件未连接。安装方式三选一（装一次长期用）：");
      console.log("   A. 浏览器扩展（推荐）：解压 plugin/build/dtc-bridge-chrome-extension.zip →");
      console.log("      chrome://extensions 开「开发者模式」→ 拖入 chrome-extension 文件夹");
      console.log("   B. 桌面 App：Figma → Plugins → Development → Import from manifest →");
      console.log("      选 plugin/build/desktop/manifest.json");
      console.log("   C. 书签：打开 plugin/build/web/dtc-bridge.bookmarklet.html 拖书签栏");
      console.log(`   装好后打开 Figma 设计文件，面板右上角显示「已连接 · ${channel}」即成。`);
      if (process.platform === "darwin") {
        try { exec(`open "${path.join(REPO_ROOT, "plugin/build/web")}"`); } catch { /* ignore */ }
      }
      if (interactive) {
        console.log(`\n等待连接（每 2s 检测一次，最长 5 分钟，Ctrl-C 跳过）...`);
        console.log(`ℹ️  若 Figma 面板已显示「已连接」但这里一直等待：检查面板 ch 输入框是否为 ${channel}`);
        console.log("    （改回 dtc 并回车即可——channel 名被误粘贴过整句文案会造成这种假等待）");
        const deadline = Date.now() + 5 * 60_000;
        let connected = false;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 2000));
          const c = new FigmaRelayClient({ joinTimeoutMs: 3000 });
          try {
            connected = (await c.ping(channel)).plugin === true;
          } finally {
            c.close();
          }
          const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
          process.stdout.write(`\r  等待插件连接... 剩余 ${left}s   `);
          if (connected) break;
        }
        process.stdout.write("\n");
        if (connected) console.log(`✅ 插件已连 channel "${channel}"`);
        else {
          console.log("⏭ 未等到连接（可稍后重跑 dtc setup 或 dtc doctor 验证）");
          ok = false;
        }
      } else {
        console.log("（非交互模式跳过等待；装好后运行 dtc doctor 验证）");
        ok = false;
      }
    }
  }

  // 6. Playwright chromium
  step(6, TOTAL, "Playwright chromium（dtc verify 用）");
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    await b.close();
    console.log("✅ chromium 就绪");
  } catch {
    console.log("→ npx playwright install chromium ...");
    try {
      sh("npx playwright install chromium");
      console.log("✅ chromium 已安装");
    } catch {
      console.warn("⚠️ chromium 安装失败（dtc verify 将不可用，可稍后手动安装）");
      ok = false;
    }
  }

  // 汇总
  console.log("\n========== setup 汇总 ==========");
  const doctorCode = await runDoctor({ channel });
  if (doctorCode === 0 && ok) {
    console.log("\n🎉 全部就绪。重启 Cursor 后，在任意项目对话框直接说：");
    console.log('   "把我在 Figma 里选中的节点还原成代码"');
  } else {
    console.log("\n⚠️ 有未完成项（见上）。修复后重跑 dtc setup。");
  }
  return doctorCode === 0 && ok ? 0 : 1;
}
