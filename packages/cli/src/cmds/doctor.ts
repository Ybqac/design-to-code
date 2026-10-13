/**
 * dtc doctor —— 环境自检：Node 版本 / relay 与插件 / Playwright 浏览器 / .dtc 规格包。
 */
import fs from "node:fs";
import { dtcPaths } from "../paths.js";
import { FigmaRelayClient } from "../ws-client.js";

export interface DoctorOptions {
  channel?: string;
  out?: string;
}

export async function runDoctor(opts: DoctorOptions): Promise<number> {
  let ok = true;
  const channel = opts.channel ?? "dtc";

  console.log("dtc doctor — 环境自检\n");

  // 1. Node
  const major = parseInt(process.versions.node.split(".")[0], 10);
  console.log(`1. Node ≥ 20: ${process.versions.node} ${major >= 20 ? "✅" : "❌"}`);
  if (major < 20) ok = false;

  // 2. relay + 插件
  const client = new FigmaRelayClient({ joinTimeoutMs: 3000 });
  try {
    const ping = await client.ping(channel);
    if (ping.relay && ping.plugin) {
      console.log(`2. relay(3055) + 插件(channel "${channel}"): ✅`);
    } else if (ping.relay) {
      console.log(`2. relay(3055): ✅，插件: ❌ 未连到 channel "${channel}"`);
      console.log(`   → 打开 Figma，运行 dtc bridge 插件（或 .user.js 注入），加入 channel "${channel}"`);
      ok = false;
    } else {
      console.log(`2. relay(3055): ❌ ${ping.detail ?? ""}`);
      console.log(`   → 在 ~/code/cursor-talk-to-figma-mcp 目录运行: bun socket`);
      ok = false;
    }
  } finally {
    client.close();
  }

  // 3. Playwright 浏览器
  try {
    const { chromium } = await import("playwright");
    const b = await chromium.launch();
    await b.close();
    console.log(`3. Playwright chromium: ✅`);
  } catch (e: any) {
    console.log(`3. Playwright chromium: ❌ ${e.message.split("\n")[0]}`);
    console.log(`   → npx playwright install chromium`);
    ok = false;
  }

  // 4. .dtc 规格包
  const p = dtcPaths(opts.out ?? ".dtc");
  const need = [p.manifest, p.groundTruth, p.unifiedTree, p.refImage];
  const missing = need.filter((f) => !fs.existsSync(f));
  if (missing.length === 0) {
    const manifest = JSON.parse(fs.readFileSync(p.manifest, "utf8"));
    const rich = (manifest.plugin_capabilities ?? []).some((c: string) => c.startsWith("rich-fields"));
    console.log(`4. .dtc 规格包: ✅（node ${manifest.node_id}，via ${manifest.via}${rich ? "，含富字段" : "，⚠️ 无 auto-layout 富字段，建议换增强插件重新 extract"}）`);
  } else {
    console.log(`4. .dtc 规格包: ⚠️ 缺 ${missing.length} 个文件（还没 extract 过，或换了目录）`);
  }

  console.log(ok ? "\n✅ doctor 通过" : "\n❌ doctor 未通过（按上面提示修复）");
  return ok ? 0 : 1;
}
