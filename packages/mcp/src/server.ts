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
import { parseVerifyReport, type VerifyReport } from "@dtc/core";
import { runDoctor, runExtract, runSel, runVerify, runCheck } from "@dtc/cli";
import type { Logger } from "@dtc/cli";
import { dtcPaths, reportPath } from "@dtc/cli";

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/** 把命令的 log/warn/error 收进返回文本。不替换全局 console。 */
function collectingLogger(): { logger: Logger; text: () => string } {
  const chunks: string[] = [];
  const push = (...args: unknown[]) => chunks.push(args.map((arg) => String(arg)).join(" "));
  return {
    logger: { log: push, warn: push, error: push },
    text: () => chunks.join("\n"),
  };
}

async function capture(fn: (logger: Logger) => Promise<unknown>): Promise<string> {
  const captured = collectingLogger();
  try {
    await fn(captured.logger);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    captured.logger.error(`\n❌ ${message}`);
  }
  return captured.text();
}

const server = new McpServer({ name: "dtc", version: "0.1.0" });

server.tool(
  "dtc_doctor",
  "dtc 环境自检：relay(3055)/Figma 插件 channel/Playwright/.dtc 规格包是否就绪",
  { channel: z.string().default("dtc"), out: z.string().default(".dtc") },
  async ({ channel, out }) => {
    let code = 0;
    const t = await capture(async (logger) => {
      code = await runDoctor({ channel, out }, logger);
    });
    return text(`${t}\nexit=${code}`);
  },
);

server.tool(
  "dtc_extract",
  "从 Figma 确定性提取规格包 → .dtc/（ground-truth 数值锁 + spec + 参考图 + 真实素材切图）。前置：dtc relay start（3055 已占用则复用）+ Figma 插件已连 channel",
  {
    node: z.string().optional().describe("Figma nodeId，如 14669-9900 或 14669:9900（与 selection 二选一）"),
    selection: z.boolean().optional().describe("为 true 时取用户当前在 Figma 里选中的第一个节点（用户说'选中的/当前这个'时用）"),
    channel: z.string().default("dtc"),
    out: z.string().default(".dtc"),
    viewport: z.string().optional().describe("WxH，默认取节点尺寸"),
    max_assets: z.number().default(60),
  },
  async ({ node, selection, channel, out, viewport, max_assets }) => {
    if (!node && !selection) {
      return text("❌ 需要 node（nodeId）或 selection=true（取当前选区）。可先调 dtc_sel 查看用户当前选中的节点。");
    }
    const t = await capture((logger) =>
      runExtract({ node, selection, channel, out, viewport, maxAssets: max_assets }, logger),
    );
    return text(t);
  },
);

server.tool(
  "dtc_sel",
  "查看用户当前在 Figma 里选中的节点（id/name/type 清单）——用户提到'选中的/当前这个节点'时先调这个确认",
  {
    channel: z.string().default("dtc"),
  },
  async ({ channel }) => {
    const t = await capture((logger) => runSel({ channel }, logger));
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
    const t = await capture(async (logger) => {
      code = await runVerify({
        url,
        out,
        viewport,
        fullPage: full_page,
        scoreThreshold: score_threshold,
        maxRounds: max_rounds,
      }, logger);
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
    let report: VerifyReport;
    try {
      report = parseVerifyReport(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return text(`报告无法解析: ${file}（${message}）`);
    }
    return text(summarizeReport(report, file));
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
    const t = await capture(async (logger) => {
      code = await runCheck({ codeDir: code_dir, out }, logger);
    });
    return text(`${t}\nexit=${code}`);
  },
);

function summarizeReport(report: VerifyReport, file: string): string {
  const regions = report.regions.map((region) => ({
    id: region.id,
    severity: region.severity,
    bbox: region.bbox,
    diffPixels: region.diffPixels,
    nodes: region.attributedNodes.map((node) => ({
      nodeId: node.nodeId,
      name: node.name,
      expected: node.expected,
      actual: node.actual,
    })),
  }));
  const structure = report.structure
    ? { score: report.structure.score, mismatches: report.structure.mismatches.length }
    : undefined;
  return JSON.stringify({
    round: report.round,
    fidelityScore: report.fidelityScore,
    pixel: report.pixel,
    structure,
    convergence: report.convergence,
    regions,
    reportFile: file,
  }, null, 2);
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("dtc-mcp ready (stdio)");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`dtc-mcp failed: ${message}`);
  process.exit(1);
});
