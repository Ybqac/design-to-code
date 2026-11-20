/**
 * dtc doctor —— 环境自检。
 * 先看安装落盘（MCP / 两条规则 / PATH 警告），再是原有四项：Node、relay+插件、chromium、.dtc。
 * relay 探测仍是 joinTimeoutMs 3000，不拉长连接。PATH 里没有 dtc 只警告，不判失败。
 */
import fs from "node:fs";
import path from "node:path";
import { parseDtcManifest, type DtcManifest } from "@dtc/core";
import { consoleLogger, type Logger } from "../logger.js";
import { dtcPaths } from "../paths.js";
import { parseJsonFile } from "../read-json.js";
import { FigmaRelayClient } from "../ws-client.js";
import {
  REPO_ROOT,
  checkMcpInstall,
  checkRulesInstall,
  commandExists,
  npmGlobalPrefix,
} from "../user-install.js";

export interface DoctorOptions {
  channel?: string;
  out?: string;
}

export async function runDoctor(opts: DoctorOptions, logger: Logger = consoleLogger): Promise<number> {
  let ok = true;
  const channel = opts.channel ?? "dtc";

  logger.log("dtc doctor — 环境自检\n");

  const mcp = checkMcpInstall();
  for (const line of mcp.lines) logger.log(line);
  if (!mcp.ok) ok = false;

  const rules = checkRulesInstall();
  for (const line of rules.lines) logger.log(line);
  if (!rules.ok) ok = false;

  if (await commandExists("dtc")) {
    logger.log("安装 · dtc PATH: ✅");
  } else {
    logger.log("安装 · dtc PATH: ⚠️ 未在 PATH（用 node 调用 dist/bin.js 时不判失败）");
    logger.log(`   → 在 ${path.join(REPO_ROOT, "packages/cli")} 执行 npm link（目标前缀 ${npmGlobalPrefix()}）`);
    logger.log("   当前终端可用 npm run dtc --");
  }

  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  logger.log(`1. Node ≥ 20: ${process.versions.node} ${major >= 20 ? "✅" : "❌"}`);
  if (major < 20) {
    logger.log("   → 安装 Node ≥ 20");
    ok = false;
  }

  const client = new FigmaRelayClient({ joinTimeoutMs: 3000 });
  try {
    const ping = await client.ping(channel);
    if (ping.relay && ping.plugin) {
      logger.log(`2. relay(3055) + 插件(channel "${channel}"): ✅`);
    } else if (ping.relay) {
      logger.log(`2. relay(3055): ✅，插件: ❌ 未连到 channel "${channel}"`);
      logger.log("   → dtc plugin install 后重新打开插件（构建时写入口令，不用手填）");
      logger.log("   （主推桌面 App Import manifest；Figma 文件首次加载可达 30s，面板就绪后再跑 dtc doctor）");
      ok = false;
    } else {
      logger.log(`2. relay(3055): ❌ ${ping.detail ?? ""}`);
      logger.log("   → dtc relay start");
      ok = false;
    }
  } finally {
    client.close();
  }

  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    await b.close();
    logger.log("3. Playwright chromium: ✅");
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    logger.log(`3. Playwright chromium: ❌ ${message}`);
    logger.log("   → npx playwright install chromium");
    ok = false;
  }

  const p = dtcPaths(opts.out ?? ".dtc");
  const need = [p.manifest, p.groundTruth, p.unifiedTree, p.refImage];
  const missing = need.filter((f) => !fs.existsSync(f));
  if (missing.length === 0) {
    const manifest = readManifest(p.manifest);
    if (!manifest.ok) {
      logger.log(`4. .dtc 规格包: ❌ ${p.manifest} 无法解析: ${manifest.message}`);
      ok = false;
    } else {
      const caps = manifest.manifest.plugin_capabilities;
      const rich = caps.some((c) => c.startsWith("rich-fields"));
      logger.log(`4. .dtc 规格包: ✅（node ${manifest.manifest.node_id}，via ${manifest.manifest.via}${rich ? "，含富字段" : "，⚠️ 无 auto-layout 富字段，建议换增强插件重新 extract"}）`);
    }
  } else {
    logger.log("4. .dtc/ 规格包: ⏳ 尚未提取（属预期——首次 dtc extract 后自动生成，无需预先准备）");
  }

  logger.log(ok ? "\n✅ doctor 通过" : "\n❌ doctor 未通过（按上面提示修复）");
  return ok ? 0 : 1;
}

function readManifest(file: string): { ok: true; manifest: DtcManifest } | { ok: false; message: string } {
  try {
    return { ok: true, manifest: parseJsonFile(file, parseDtcManifest) };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, message };
  }
}
