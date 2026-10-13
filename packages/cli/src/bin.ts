#!/usr/bin/env node
/**
 * dtc —— design-to-code 工作流 CLI
 *
 *   dtc extract --node 14669-9900 [--channel dtc] [--out .dtc]
 *   dtc verify  --url http://localhost:5173 [--viewport 1440x900] [--full-page]
 *   dtc check   <code-dir> [--out .dtc]
 *   dtc plugin  build|install
 *   dtc doctor
 */
import { Command } from "commander";
import { runExtract } from "./cmds/extract.js";
import { runVerify } from "./cmds/verify.js";
import { runCheck } from "./cmds/check.js";
import { runDoctor } from "./cmds/doctor.js";
import { runPlugin } from "./cmds/plugin.js";

const program = new Command();
program.name("dtc").description("design-to-code 高保真 Figma→代码闭环工作流").version("0.1.0");

program
  .command("extract")
  .description("从 Figma 确定性提取规格包（节点树/ground-truth/spec/参考图/素材）→ .dtc/")
  .requiredOption("--node <id>", "Figma nodeId（14669-9900 或 14669:9900）")
  .option("--channel <name>", "TalkToFigma 插件 channel", "dtc")
  .option("--out <dir>", "输出目录", ".dtc")
  .option("--viewport <wxh>", "视口（默认取节点尺寸）")
  .option("--ref-scale <n>", "参考图倍率", "2")
  .option("--from-rest", "走 Figma REST API（需 --file-key --pat，受限流）")
  .option("--file-key <key>")
  .option("--pat <token>")
  .option("--from-snapshot <file>", "从本地快照 JSON 重放（离线）")
  .option("--max-assets <n>", "素材导出上限", "60")
  .action(async (opts) => {
    await runExtract({
      node: opts.node,
      channel: opts.channel,
      out: opts.out,
      viewport: opts.viewport,
      refScale: Number(opts.refScale),
      fromRest: opts.fromRest,
      fileKey: opts.fileKey,
      pat: opts.pat,
      fromSnapshot: opts.fromSnapshot,
      maxAssets: Number(opts.maxAssets),
    });
  });

program
  .command("verify")
  .description("视觉回归闭环：截图 → diff → 归因 → report + fix-prompt（退出码 0=收敛 1=继续 2=停止）")
  .requiredOption("--url <url>", "实现页地址（http(s)://、file:// 或本地 html 路径）")
  .option("--out <dir>", ".dtc 目录", ".dtc")
  .option("--viewport <wxh>", "覆盖 manifest 视口")
  .option("--full-page", "整页截图")
  .option("--round <n>", "轮次（默认自动递增）")
  .option("--pixel-threshold <n>", "pixelmatch threshold", "0.1")
  .option("--score-threshold <n>", "收敛分数线", "95")
  .option("--max-stalled <n>", "停滞轮数上限", "3")
  .option("--max-rounds <n>", "轮次上限", "10")
  .option("--wait-ms <n>", "渲染后额外等待 ms", "500")
  .action(async (opts) => {
    const code = await runVerify({
      url: opts.url,
      out: opts.out,
      viewport: opts.viewport,
      fullPage: opts.fullPage,
      round: opts.round ? Number(opts.round) : undefined,
      pixelThreshold: Number(opts.pixelThreshold),
      scoreThreshold: Number(opts.scoreThreshold),
      maxStalled: Number(opts.maxStalled),
      maxRounds: Number(opts.maxRounds),
      waitMs: Number(opts.waitMs),
    });
    process.exitCode = code;
  });

program
  .command("check")
  .description("反捏造校验：ground-truth 溯源 + 代码硬编码值反查")
  .argument("<code-dir>", "生成代码目录")
  .option("--out <dir>", ".dtc 目录", ".dtc")
  .option("--skip-provenance", "跳过溯源校验")
  .option("--skip-scan", "跳过代码扫描")
  .action(async (codeDir: string, opts) => {
    process.exitCode = await runCheck({
      codeDir,
      out: opts.out,
      skipProvenance: opts.skipProvenance,
      skipScan: opts.skipScan,
    });
  });

program
  .command("plugin")
  .description("通道打包：build 三形态（desktop/.user.js/bookmarklet）、install 安装指引")
  .argument("<action>", "build | install")
  .option("--src <dir>", "插件源码目录（默认 <repo>/plugin/src）")
  .option("--dist <dir>", "产物目录（默认 <repo>/plugin/build）")
  .action(async (action: string, opts) => {
    await runPlugin(action, opts);
  });

program
  .command("doctor")
  .description("环境自检（relay/插件/Playwright/.dtc）")
  .option("--channel <name>", "channel", "dtc")
  .option("--out <dir>", ".dtc 目录", ".dtc")
  .action(async (opts) => {
    process.exitCode = await runDoctor(opts);
  });

program.parseAsync(process.argv).catch((e: Error) => {
  console.error(`\n❌ ${e.message}`);
  process.exit(1);
});
