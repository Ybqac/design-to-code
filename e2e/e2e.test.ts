/**
 * 合成端到端：extract（快照重放）→ 生成参考图 → verify（缺陷页）→ 修正（等同设计页）→ 收敛 → check。
 *
 * 验证闭环的关键性质：
 *  - 缺陷页 score < 阈值且热区归因到正确的 nodeId（按钮/输入框/链接/卡片/标题）
 *  - fix-prompt 含 ground-truth 期望值（如 #3b82f6）
 *  - 结构校验抓到字号错误（18 vs 20）
 *  - 第二轮（修正后）收敛 exit=0，且分数相对第一轮提升（收敛协议）
 *  - check 抓到占位图 URL 与未溯源颜色
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { expect, test } from "vitest";

const exec = promisify(execFile);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..");
const bin = path.join(repo, "packages/cli/dist/bin.js");
const outDir = path.join(here, ".dtc");
const mockPage = path.join(here, "pages/design-mock.html");
const brokenPage = path.join(here, "pages/impl-broken.html");

async function dtc(...args: string[]) {
  try {
    const { stdout } = await exec("node", [bin, ...args], { cwd: repo, timeout: 120_000 });
    return { code: 0, stdout };
  } catch (e: any) {
    return { code: e.code ?? 1, stdout: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

test("e2e: extract → verify(broken) → verify(fixed) → check", { timeout: 180_000 }, async () => {
  // ---------- 1. extract（快照重放，产出 .dtc 规格包） ----------
  fs.rmSync(outDir, { recursive: true, force: true });
  const ex = await dtc(
    "extract", "--node", "14669-9900",
    "--from-snapshot", path.join(here, "fixtures/login-card-snapshot.json"),
    "--out", outDir, "--viewport", "360x640",
  );
  expect(ex.code, ex.stdout).toBe(0);
  for (const f of ["manifest.json", "raw-node-snapshot.json", "unified-tree.json", "design-ground-truth.json", "spec.json"]) {
    expect(fs.existsSync(path.join(outDir, f)), f).toBe(true);
  }
  const gt = JSON.parse(fs.readFileSync(path.join(outDir, "design-ground-truth.json"), "utf8"));
  expect(gt.raw_styles.length).toBeGreaterThanOrEqual(7);
  expect(gt.raw_styles.find((s: any) => s.nodeId === "14669:1005")?.fills[0].color).toBe("#3b82f6");
  expect(gt.source.via).toContain("snapshot");

  // ---------- 2. 生成参考图（模拟 Figma 2x 导出，同时锻炼对齐缩放） ----------
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 2 });
  await page.goto("file://" + mockPage);
  await page.evaluate(() => document.fonts?.ready?.catch(() => {}));
  await page.waitForTimeout(200);
  fs.mkdirSync(path.join(outDir, "ref"), { recursive: true });
  fs.writeFileSync(path.join(outDir, "ref", "frame.png"), await page.screenshot());
  await page.close();
  await browser.close();

  // ---------- 3. verify 缺陷页：应 exit=1 且归因正确 ----------
  const v1 = await dtc("verify", "--url", brokenPage, "--out", outDir, "--viewport", "360x640", "--wait-ms", "200");
  expect(v1.code, v1.stdout).toBe(1);
  const report1 = JSON.parse(fs.readFileSync(path.join(outDir, "verify", "report-1.json"), "utf8"));
  expect(report1.fidelityScore).toBeLessThan(95);
  expect(report1.pixel.clusters).toBeGreaterThan(0);

  const attributed = new Set(report1.regions.flatMap((r: any) => r.attributedNodes.map((n: any) => n.nodeId)));
  expect(attributed.has("14669:1005"), "按钮色差异应归因到 Submit Button").toBe(true); // 按钮颜色

  // 结构校验抓到标题字号错误（18 vs 20）与链接颜色错误（互补检测：细微文本色差走 DOM 值比对）
  const fontSizeMismatch = report1.structure.mismatches.find((m: any) => m.kind === "fontSize" && m.nodeId === "14669:1001");
  expect(fontSizeMismatch, JSON.stringify(report1.structure.mismatches)).toBeTruthy();
  expect(fontSizeMismatch.expected).toBe("20px");
  expect(fontSizeMismatch.actual).toBe("18px");
  const colorMismatch = report1.structure.mismatches.find((m: any) => m.kind === "color" && m.nodeId === "14669:1007");
  expect(colorMismatch, JSON.stringify(report1.structure.mismatches)).toBeTruthy();
  expect(colorMismatch.expected?.toLowerCase()).toContain("#2563eb");

  // fix-prompt 含期望值与归因
  const fix = fs.readFileSync(path.join(outDir, "verify", "fix-prompt.md"), "utf8");
  expect(fix).toContain("14669:1005");
  expect(fix).toContain("#3b82f6");

  // ---------- 4. 换成与设计一致的实现 → 第二轮应收敛 ----------
  {
    const b = await chromium.launch();
    const p = await b.newPage({ viewport: { width: 360, height: 640 }, deviceScaleFactor: 1 });
    await p.goto("file://" + mockPage);
    await p.evaluate(() => document.fonts?.ready?.catch(() => {}));
    await p.waitForTimeout(200);
    fs.writeFileSync(path.join(outDir, "ref", "frame.png"), await p.screenshot());
    await p.close();
    await b.close();
  }
  const v2 = await dtc("verify", "--url", mockPage, "--out", outDir, "--viewport", "360x640", "--wait-ms", "200");
  expect(v2.code, v2.stdout).toBe(0);
  const report2 = JSON.parse(fs.readFileSync(path.join(outDir, "verify", "report-2.json"), "utf8"));
  expect(report2.convergence.converged).toBe(true);
  expect(report2.fidelityScore).toBeGreaterThanOrEqual(95);
  expect(report2.fidelityScore).toBeGreaterThan(report1.fidelityScore);
  expect(report2.convergence.previousScore).toBe(report1.fidelityScore);

  // ---------- 5. check：占位图红线 + 硬编码色反查 ----------
  const badCode = path.join(here, ".bad-code");
  fs.rmSync(badCode, { recursive: true, force: true });
  fs.mkdirSync(badCode, { recursive: true });
  fs.writeFileSync(
    path.join(badCode, "App.css"),
    `.btn { background: #60A5FA; }\n.hero img { content: url(https://picsum.photos/300); }\n`,
  );
  const c1 = await dtc("check", badCode, "--out", outDir);
  expect(c1.code, c1.stdout).toBe(1);
  expect(c1.stdout).toContain("占位图");
  expect(c1.stdout).toContain("#60a5fa");

  // 干净代码（全部值来自 ground-truth）→ 通过
  const goodCode = path.join(here, ".good-code");
  fs.rmSync(goodCode, { recursive: true, force: true });
  fs.mkdirSync(goodCode, { recursive: true });
  fs.writeFileSync(
    path.join(goodCode, "App.css"),
    `.btn { background: #3B82F6; border-radius: 8px; }\n.title { color: #111827; }\n`,
  );
  const c2 = await dtc("check", goodCode, "--out", outDir);
  expect(c2.code, c2.stdout).toBe(0);
}, 180_000);
