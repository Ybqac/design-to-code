/**
 * dtc doctor —— 环境自检。
 * 先看安装落盘（MCP / 两条规则 / PATH 警告），再是原有四项：Node、relay+插件、chromium、.dtc。
 * relay 探测仍是 joinTimeoutMs 3000，不拉长连接。PATH 里没有 dtc 只警告，不判失败。
 */
import fs from "node:fs";
import path from "node:path";
import { dtcPaths } from "../paths.js";
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

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  let ok = true;
  const channel = opts.channel ?? "dtc";

  console.log("dtc doctor — 环境自检\n");

  const mcp = checkMcpInstall();
  for (const line of mcp.lines) console.log(line);
  if (!mcp.ok) ok = false;

  const rules = checkRulesInstall();
  for (const line of rules.lines) console.log(line);
  if (!rules.ok) ok = false;

  if (await commandExists("dtc")) {
    console.log("安装 · dtc PATH: ✅");
  } else {
    console.log("安装 · dtc PATH: ⚠️ 未在 PATH（用 node 调用 dist/bin.js 时不判失败）");
    console.log(`   → 在 ${path.join(REPO_ROOT, "packages/cli")} 执行 npm link（目标前缀 ${npmGlobalPrefix()}）`);
    console.log("   当前终端可用 npm run dtc --");
  }

  const major = parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  console.log(`1. Node ≥ 20: ${process.versions.node} ${major >= 20 ? "✅" : "❌"}`);
  if (major < 20) {
    console.log("   → 安装 Node ≥ 20");
    ok = false;
  }

  const client = new FigmaRelayClient({ joinTimeoutMs: 3000 });
  try {
    const ping = await client.ping(channel);
    if (ping.relay && ping.plugin) {
      console.log(`2. relay(3055) + 插件(channel "${channel}"): ✅`);
    } else if (ping.relay) {
      console.log(`2. relay(3055): ✅，插件: ❌ 未连到 channel "${channel}"`);
      console.log("   → dtc plugin install");
      console.log("   （主推桌面 App Import manifest；Figma 文件首次加载可达 30s，面板就绪后再跑 dtc doctor）");
      ok = false;
    } else {
      console.log(`2. relay(3055): ❌ ${ping.detail ?? ""}`);
      console.log("   → dtc relay start");
      ok = false;
    }
  } finally {
    client.close();
  }

  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    await b.close();
    console.log("3. Playwright chromium: ✅");
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message.split("\n")[0] : String(e);
    console.log(`3. Playwright chromium: ❌ ${message}`);
    console.log("   → npx playwright install chromium");
    ok = false;
  }

  const p = dtcPaths(opts.out ?? ".dtc");
  const need = [p.manifest, p.groundTruth, p.unifiedTree, p.refImage];
  const missing = need.filter((f) => !fs.existsSync(f));
  if (missing.length === 0) {
    const manifest = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
    const rich = (manifest.plugin_capabilities ?? []).some((c: string) => c.startsWith("rich-fields"));
    console.log(`4. .dtc 规格包: ✅（node ${manifest.node_id}，via ${manifest.via}${rich ? "，含富字段" : "，⚠️ 无 auto-layout 富字段，建议换增强插件重新 extract"}）`);
  } else {
    console.log("4. .dtc/ 规格包: ⏳ 尚未提取（属预期——首次 dtc extract 后自动生成，无需预先准备）");
  }

  console.log(ok ? "\n✅ doctor 通过" : "\n❌ doctor 未通过（按上面提示修复）");
  return ok ? 0 : 1;
}
