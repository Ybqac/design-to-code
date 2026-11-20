/**
 * dtc setup —— 全局安装。目标项目默认零安装。
 *
 * 1 构建自检 → 2 npm link → 3 relay → 4 Cursor MCP + 两条规则 + skill
 * → 5 Figma 通道（主推桌面 manifest）→ 6 chromium → doctor。
 * `--project` 只额外拷斜杠命令，不写项目级 rules / mcp。
 */
import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { channelGuideLines } from "../channel-guide.js";
import { FigmaRelayClient } from "../ws-client.js";
import { runDoctor } from "./doctor.js";
import { relayUp, runRelay } from "./relay.js";
import { runPlugin } from "./plugin.js";
import {
  REPO_ROOT,
  applyGlobalInstall,
  commandExists,
  copyProjectCommands,
  mcpPath,
  npmGlobalPrefix,
  ownedPaths,
} from "../user-install.js";

export interface SetupOptions {
  yes?: boolean;
  channel?: string;
  project?: string;
}

function sh(cmd: string, cwd = REPO_ROOT): void {
  execSync(cmd, { cwd, stdio: "inherit" });
}

function step(n: number, total: number, title: string): void {
  console.log(`\n[${n}/${total}] ${title}`);
}

function printPlan(project?: string): void {
  console.log("将覆盖（安装器拥有，不合并手工编辑）：");
  for (const file of ownedPaths()) console.log(`  ${file}`);
  console.log(`合并写入（保留其他 mcpServers，dtc 条目覆盖）：${mcpPath()}`);
  if (project) console.log(`只拷斜杠命令：${path.resolve(project)}/.cursor/commands/`);
}

async function linkGlobal(): Promise<boolean> {
  const prefix = npmGlobalPrefix();
  if (await commandExists("dtc")) {
    console.log("✅ dtc 已在 PATH。新开终端后用 dtc；当前终端可用 npm run dtc --");
    return true;
  }
  console.log("→ npm link（全局命令）...");
  try {
    sh("npm link", path.join(REPO_ROOT, "packages/cli"));
  } catch {
    console.log(`❌ npm link 失败，dtc 不在 PATH。link 目标前缀：${prefix}`);
    console.log("   当前终端可用 npm run dtc --");
    return false;
  }
  if (await commandExists("dtc")) {
    console.log("✅ npm link 完成。新开终端后用 dtc；当前终端可用 npm run dtc --");
  } else {
    console.log(`⚠️ npm link 已执行，但 PATH 里仍没有 dtc。link 目标前缀：${prefix}`);
    console.log("   新开终端后用 dtc；当前终端可用 npm run dtc --");
  }
  return true;
}

export async function runSetup(opts: SetupOptions): Promise<number> {
  const interactive = process.stdout.isTTY === true && !opts.yes;
  const channel = opts.channel ?? "dtc";
  const total = 6;
  let ok = true;

  printPlan(opts.project);

  step(1, total, "构建自检");
  const needBuild = !fs.existsSync(path.join(REPO_ROOT, "packages/mcp/dist/server.js"));
  if (needBuild) {
    console.log("→ dist 缺失，执行 npm install && npm run build ...");
    sh("npm install && npm run build");
  } else {
    console.log("✅ 构建产物就绪");
  }

  step(2, total, "dtc 全局命令");
  if (!(await linkGlobal())) ok = false;

  step(3, total, "relay（ws://localhost:3055）");
  if (await relayUp()) {
    console.log("✅ relay 已在运行（复用，不重复启动）");
  } else {
    console.log("→ 自动启动内置 relay（后台守护，日志 ~/.dtc/relay.log）...");
    const code = await runRelay("start");
    if (code !== 0) ok = false;
  }
  try {
    await runPlugin("build", {});
    console.log("relay 口令已写入 plugin/build。重新打开 Figma 插件即可，不用手填");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.log(`❌ 插件构建失败：${message}`);
    ok = false;
  }

  step(4, total, "Cursor 全局接入");
  const installed = applyGlobalInstall(REPO_ROOT);
  for (const line of installed.lines) console.log(line);
  if (!installed.mcpOk) ok = false;
  if (opts.project) {
    const names = copyProjectCommands(REPO_ROOT, opts.project);
    const commandsDir = path.join(path.resolve(opts.project), ".cursor", "commands");
    console.log(`✅ 斜杠命令: ${names.join(", ")} → ${commandsDir}`);
    console.log("   未写项目级 rules，未写项目级 mcp");
  }

  step(5, total, "Figma 通道（插件/扩展连到 channel）");
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
      for (const line of channelGuideLines(path.join(REPO_ROOT, "plugin/build"))) console.log(line);
      console.log(`装好后打开 Figma 设计文件，面板右上角显示「已连接 · ${channel}」即成。`);
      console.log("relay 未就绪时：dtc relay start（3055 已占用则复用）");
      if (interactive) {
        const desktopDir = path.join(REPO_ROOT, "plugin/build/desktop");
        if (process.platform === "darwin" && fs.existsSync(desktopDir)) {
          try {
            exec(`open "${desktopDir}"`);
          } catch {
            /* ignore */
          }
        }
        console.log("\n等待连接（每 2s 检测一次，最长 5 分钟，Ctrl-C 跳过）...");
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

  step(6, total, "Playwright chromium（dtc verify 用）");
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

  console.log("\n========== setup 汇总 ==========");
  const doctorCode = await runDoctor({ channel });
  if (doctorCode === 0 && ok) {
    console.log("\n🎉 全部就绪。重启 Cursor 后，在任意项目对话框直接说：");
    console.log('   "把我在 Figma 里选中的节点还原成代码"');
    console.log("新开终端后用 dtc；当前终端可用 npm run dtc --");
  } else {
    console.log("\n⚠️ 有未完成项（见上）。修复后重跑 dtc setup。");
  }
  return doctorCode === 0 && ok ? 0 : 1;
}
