/**
 * fix-prompt 生成：VerifyReport → fix-prompt.md。
 *
 * 目标：agent 读完就能动手改——每条差异带热区截图坐标、归因 nodeId、期望值
 * （ground-truth）与实际值（DOM 探针），并按 severity 排序给出修复优先级。
 */
import type { VerifyReport } from "./schema.js";

export function renderFixPrompt(report: VerifyReport, refImageRel = "../ref/frame.png", diffImageRel = "./diff.png"): string {
  const lines: string[] = [];
  const score = report.fidelityScore;
  const needFix = report.convergence.threshold - score;

  lines.push(`# fix-prompt（第 ${report.round} 轮）`);
  lines.push("");
  lines.push(`- Fidelity Score: **${score} / 100**（像素 ${report.pixel.score}，结构 ${report.structure?.score ?? "-"}）`);
  lines.push(`- 收敛阈值 ${report.convergence.threshold}，还差 **${Math.max(0, Math.round(needFix * 10) / 10)}** 分`);
  lines.push(`- 参考图: \`${refImageRel}\`｜差异图: \`${diffImageRel}\`｜实现截图: \`./impl.png\``);
  if (report.convergence.reason) lines.push(`- 收敛状态: ${report.convergence.converged ? "✅ 已收敛" : "⏳"} — ${report.convergence.reason}`);
  lines.push("");

  if (report.regions.length === 0) {
    lines.push("无显著差异热区。若分数未达标，检查全图轻微色差/抗锯齿底噪，或运行结构校验核对文本。");
    return lines.join("\n");
  }

  lines.push(`## 差异热区（${report.regions.length} 个，按差异面积降序）`);
  lines.push("");
  lines.push("| # | 严重度 | 区域(x,y,w,h) | 差异px | 归因节点 |");
  lines.push("|---|--------|---------------|--------|----------|");
  report.regions.forEach((r, i) => {
    const b = r.bbox;
    const nodes = r.attributedNodes.map((n) => `\`${n.nodeId}\`${n.name ? ` ${n.name}` : ""}`).join("、") || "-";
    lines.push(`| ${i + 1} | ${sev(r.severity)} | ${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)} | ${r.diffPixels} | ${nodes} |`);
  });
  lines.push("");

  const withNodes = report.regions.filter((r) => r.attributedNodes.length > 0);
  if (withNodes.length > 0) {
    lines.push("## 期望 vs 实际（来自 design-ground-truth.json 与 DOM 探针）");
    lines.push("");
    for (const r of withNodes) {
      lines.push(`### ${r.id}（${sev(r.severity)}）区域 ${Math.round(r.bbox.x)},${Math.round(r.bbox.y)},${Math.round(r.bbox.width)}x${Math.round(r.bbox.height)}`);
      for (const n of r.attributedNodes) {
        lines.push(`- **\`${n.nodeId}\`** ${n.name ?? ""}（${n.role ?? n.type ?? "node"}）`);
        if (n.expected) for (const [k, v] of Object.entries(n.expected)) lines.push(`  - 期望 ${k}: \`${String(v)}\``);
        if (n.actual) for (const [k, v] of Object.entries(n.actual)) lines.push(`  - 实际 ${k}: \`${String(v)}\``);
        if (!n.expected && !n.actual) lines.push("  - （无样式探针，请对照参考图该区域）");
      }
      lines.push("");
    }
  }

  if (report.structure?.mismatches.length) {
    lines.push("## 结构校验不匹配（文本内容/字号/颜色）");
    lines.push("");
    for (const m of report.structure.mismatches) {
      lines.push(`- [${m.kind}] ${m.nodeId ? `\`${m.nodeId}\` ` : ""}期望 \`${m.expected ?? "-"}\` 实际 \`${m.actual ?? "（缺失）"}\`${m.detail ? ` — ${m.detail}` : ""}`);
    }
    lines.push("");
  }

  lines.push("## 修复要求");
  lines.push("");
  lines.push("1. 按严重度从高到低修复：high（整块布局/大色差）→ medium（局部错位/字号）→ low（细小底噪可说明后忽略）。");
  lines.push("2. 每处修改的数值以 `.dtc/design-ground-truth.json` 对应 nodeId 的条目为准，不要估读。");
  lines.push("3. 缺失资产请从 `.dtc/assets/` 取真实切图，禁止占位图与通用 SVG 替代。");
  lines.push("4. 改完后重新运行 `dtc verify`，直到 score 达到阈值或触发停滞停止。");
  return lines.join("\n");
}

function sev(s: string): string {
  return s === "high" ? "🔴 high" : s === "medium" ? "🟡 medium" : "🟢 low";
}
