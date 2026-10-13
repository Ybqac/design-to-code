/**
 * @dtc/mcp —— stdio MCP server，把 dtc CLI 的闭环能力暴露给 Cursor / Claude 等 agent。
 *
 * tools:
 *   dtc_doctor      环境自检（relay/插件/Playwright/.dtc）
 *   dtc_extract     确定性提取规格包（节点树/ground-truth/spec/参考图/素材）
 *   dtc_verify      视觉回归闭环（截图→diff→归因→report）
 *   dtc_read_report 读最新（或指定轮次）report 摘要
 *   dtc_fix_prompt  读当前 fix-prompt.md 全文（agent 修正依据）
 *   dtc_check       反捏造校验（溯源 + 硬编码扫描）
 */
import fs from "node:fs";
import path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runDoctor, runExtract, runVerify, runCheck } from "@dtc/cli";
import { dtcPaths, reportPath } from "@dtc/cli";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/** 捕获 console 输出转为 MCP 返回文本 */
async function capture(fn: () => Promise<unknown>): Promise<string> {
  const chunks: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const push = (...args: unknown[]) => chunks.push(args.map(String).join(" "));
  console.log = push;
  console.warn = push;
  console.error = push;
  try {
    await fn();
  } catch (e: any) {
    chunks.push(`\n❌ ${e.message}`);
  } finally {
    console.log = orig.log;
    console.warn = orig.warn;
    console.error = orig.error;
  }
  return chunks.join("\n");
}

const server = new McpServer({ name: "dtc", version: "0.1.0" });

server.tool(
  "dtc_doctor",
  "dtc 环境自检：relay(3055)/Figma 插件 channel/Playwright/.dtc 规格包是否就绪",
  { channel: z.string().default("dtc"), out: z.string().default(".dtc") },
  async ({ channel, out }) => {
    let code = 0;
    const t = await capture(async () => {
      code = await runDoctor({ channel, out });
    });
    return text(`${t}\nexit=${code}`);
  },
);

server.tool(
  "dtc_extract",
  "从 Figma 确定性提取规格包 → .dtc/（ground-truth 数值锁 + spec + 参考图 + 真实素材切图）。前置：bun socket + Figma 插件已连 channel",
  {
    node: z.string().describe("Figma nodeId，如 14669-9900 或 14669:9900"),
    channel: z.string().default("dtc"),
    out: z.string().default(".dtc"),
    viewport: z.string().optional().describe("WxH，默认取节点尺寸"),
    max_assets: z.number().default(60),
  },
  async ({ node, channel, out, viewport, max_assets }) => {
    const t = await capture(() =>
      runExtract({ node, channel, out, viewport, maxAssets: max_assets }),
    );
    return text(t);
  },
);

server.tool(
  "dtc_verify",
  "视觉回归闭环：Playwright 截图实现页 → 与 Figma 参考图 pixelmatch diff → 热区聚类 → nodeId 归因 → report-N.json + fix-prompt.md。返回摘要（分数/热区/收敛状态）",
  {
    url: z.string().describe("实现页地址（http(s):// 或本地 html 路径）"),
    out: z.string().default(".dtc"),
    viewport: z.string().optional(),
    full_page: z.boolean().default(false),
    score_threshold: z.number().default(95),
    max_rounds: z.number().default(10),
  },
  async ({ url, out, viewport, full_page, score_threshold, max_rounds }) => {
    let code = 0;
    const t = await capture(async () => {
      code = await runVerify({
        url,
        out,
        viewport,
        fullPage: full_page,
        scoreThreshold: score_threshold,
        maxRounds: max_rounds,
      });
    });
    return text(`${t}\nexit=${code}（0=收敛 1=继续修正 2=停滞需人工）`);
  },
);

server.tool(
  "dtc_read_report",
  "读最新（或指定轮次）验证报告摘要：分数、热区、归因节点、收敛状态",
  {
    out: z.string().default(".dtc"),
    round: z.number().optional(),
  },
  async ({ out, round }) => {
    const p = dtcPaths(out);
    const r = round ?? (await import("@dtc/cli").then((m) => m.nextRound(p.verifyDir)) - 1);
    const file = reportPath(p.verifyDir, r);
    if (!fs.existsSync(file)) return text(`未找到报告: ${file}（先跑 dtc_verify）`);
    const report = JSON.parse(fs.readFileSync(file, "utf8"));
    const summary = {
      round: report.round,
      fidelityScore: report.fidelityScore,
      pixel: report.pixel,
      structure: report.structure ? { score: report.structure.score, mismatches: report.structure.mismatches.length } : undefined,
      convergence: report.convergence,
      regions: report.regions.map((x: any) => ({
        id: x.id,
        severity: x.severity,
        bbox: x.bbox,
        diffPixels: x.diffPixels,
        nodes: x.attributedNodes.map((n: any) => ({ nodeId: n.nodeId, name: n.name, expected: n.expected, actual: n.actual })),
      })),
      reportFile: file,
    };
    return text(JSON.stringify(summary, null, 2));
  },
);

server.tool(
  "dtc_fix_prompt",
  "读当前 fix-prompt.md 全文（含热区/归因/期望vs实际/修复要求），是下一轮代码修正的直接依据",
  { out: z.string().default(".dtc") },
  async ({ out }) => {
    const fp = path.join(dtcPaths(out).verifyDir, "fix-prompt.md");
    if (!fs.existsSync(fp)) return text(`未找到 fix-prompt: ${fp}（先跑 dtc_verify）`);
    return text(fs.readFileSync(fp, "utf8"));
  },
);

server.tool(
  "dtc_check",
  "反捏造校验：ground-truth 溯源（每个值必须来自原始节点树）+ 代码硬编码颜色/尺寸反查 + 占位图红线",
  {
    code_dir: z.string().describe("生成代码目录"),
    out: z.string().default(".dtc"),
  },
  async ({ code_dir, out }) => {
    let code = 0;
    const t = await capture(async () => {
      code = await runCheck({ codeDir: code_dir, out });
    });
    return text(`${t}\nexit=${code}`);
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dtc-mcp ready (stdio)");
}

main().catch((e: Error) => {
  console.error(`dtc-mcp failed: ${e.message}`);
  process.exit(1);
});
