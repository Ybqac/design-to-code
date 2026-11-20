/**
 * 安装落盘的纯函数与临时目录检查。不读用户真实 HOME。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import {
  REPO_ROOT,
  RERUN_SETUP,
  checkMcpInstall,
  checkRulesInstall,
  copyProjectCommands,
  installedSkill,
  planMcpWrite,
} from "./user-install.js";

const tmpDirs: string[] = [];

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtc-install-"));
  tmpDirs.push(dir);
  return dir;
}

it("REPO_ROOT 指向仓库根", () => {
  expect(REPO_ROOT).toBe(path.resolve(fileURLToPath(import.meta.url), "../../../.."));
  expect(fs.existsSync(path.join(REPO_ROOT, "package.json"))).toBe(true);
});

it("合并 mcp 保留其他 server，路径不同时打印旧值", () => {
  const existing = JSON.stringify({
    inputs: [],
    mcpServers: {
      other: { command: "npx", args: ["-y", "other"] },
      dtc: { command: "node", args: ["/old/server.js"] },
    },
  });
  const plan = planMcpWrite(existing, "/new/server.js", "mcp.json");
  expect(plan.ok).toBe(true);
  if (!plan.ok) return;
  const body = JSON.parse(plan.body) as {
    inputs: unknown[];
    mcpServers: { other: { args: string[] }; dtc: { command: string; args: string[] } };
  };
  expect(body.inputs).toEqual([]);
  expect(body.mcpServers.other.args).toEqual(["-y", "other"]);
  expect(body.mcpServers.dtc).toEqual({ command: "node", args: ["/new/server.js"] });
  expect(plan.lines.join("\n")).toContain("/old/server.js");
  expect(JSON.parse(existing).mcpServers.dtc.args).toEqual(["/old/server.js"]);
});

it("mcp 解析失败不产出覆盖正文", () => {
  const plan = planMcpWrite("{", "/new/server.js", "mcp.json");
  expect(plan.ok).toBe(false);
  expect(plan.lines.join("\n")).toContain(RERUN_SETUP);
  expect("body" in plan).toBe(false);
});

it("server.js 不存在时 doctor 安装检查要求重跑 setup", () => {
  const dir = tmp();
  const file = path.join(dir, "mcp.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ mcpServers: { dtc: { command: "node", args: ["/missing/server.js"] } } }),
  );
  const check = checkMcpInstall(file);
  expect(check.ok).toBe(false);
  expect(check.lines.join("\n")).toContain("dtc setup");
  expect(check.lines.join("\n")).toContain("/missing/server.js");
});

it("两条规则缺一即失败并给出 setup", () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, "dtc-workflow.mdc"), "# x\n");
  const missing = checkRulesInstall(dir);
  expect(missing.ok).toBe(false);
  expect(missing.lines.join("\n")).toContain("dtc-anti-fabrication.mdc");
  expect(missing.lines.join("\n")).toContain("dtc setup");
  fs.writeFileSync(path.join(dir, "dtc-anti-fabrication.mdc"), "# y\n");
  expect(checkRulesInstall(dir).ok).toBe(true);
});

it("安装 skill 用仓库绝对路径，不写死家目录克隆路径", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "skills/design-to-code/SKILL.md"), "utf8");
  expect(src).not.toContain("~/code/design-to-code-plugin");
  const out = installedSkill(src, "/opt/dtc-repo");
  expect(out).toContain("/opt/dtc-repo/skills/design-to-code/references/");
  expect(out).toContain("skills/design-to-code/references/");
  expect(out).not.toContain("~/code/design-to-code-plugin");
  const keys = ["**doctor**", "**取源**", "**4 行闸口**", "**生成**", "**verify**", "**check**"];
  const at = keys.map((k) => out.indexOf(k));
  expect(at.every((n, i) => n > -1 && (i === 0 || n > at[i - 1]!))).toBe(true);
});

it("全局规则含技术栈 6 条且与 skill 同序", () => {
  const rule = fs.readFileSync(
    path.join(REPO_ROOT, "integrations/cursor/rules-global/dtc-workflow.mdc"),
    "utf8",
  );
  for (const label of ["**框架**", "**样式方案**", "**设计 token 接入**", "**组件惯例**", "**路由/目录**", "**单位**"]) {
    expect(rule).toContain(label);
  }
  const keys = ["**doctor**", "**取源**", "**4 行闸口**", "**生成**", "**verify**", "**check**"];
  const at = keys.map((k) => rule.indexOf(k));
  expect(at.every((n, i) => n > -1 && (i === 0 || n > at[i - 1]!))).toBe(true);
});

it("--project 只拷 commands，不建项目 rules", () => {
  const project = tmp();
  const names = copyProjectCommands(REPO_ROOT, project);
  expect(names).toEqual(["design-to-code.md", "dtc-verify.md"]);
  expect(fs.existsSync(path.join(project, ".cursor/commands/design-to-code.md"))).toBe(true);
  expect(fs.existsSync(path.join(project, ".cursor/commands/dtc-verify.md"))).toBe(true);
  expect(fs.existsSync(path.join(project, ".cursor/rules/f2c-workflow.mdc"))).toBe(false);
  expect(fs.existsSync(path.join(project, ".cursor/mcp.json"))).toBe(false);
});
