/**
 * 全局安装落盘：~/.cursor/mcp.json（合并）、~/.cursor/rules/ 两条、~/.agents/skills 一份 skill。
 * 这些路径跟 os.homedir()，测试用临时 HOME 注入，不写调用者的真实家目录。
 *
 * REPO_ROOT 用四层 ../：源码在 packages/cli/src/，打包后在 packages/cli/dist/，两处都到仓库根。
 */
import { exec, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execA = promisify(exec);

export const REPO_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../../..");

export const RERUN_SETUP = "重跑 dtc setup（当前终端：npm run dtc -- setup）";

export const RULE_FILES = ["dtc-workflow.mdc", "dtc-anti-fabrication.mdc"] as const;

export function cursorDir(): string {
  return path.join(os.homedir(), ".cursor");
}

export function mcpPath(): string {
  return path.join(cursorDir(), "mcp.json");
}

export function rulesDir(): string {
  return path.join(cursorDir(), "rules");
}

export function skillPath(): string {
  return path.join(os.homedir(), ".agents", "skills", "design-to-code", "SKILL.md");
}

export function serverJsPath(repoRoot = REPO_ROOT): string {
  return path.join(repoRoot, "packages/mcp/dist/server.js");
}

/** 安装器整文件覆盖的路径（不含 mcp.json：那个要合并其他 server）。 */
export function ownedPaths(): string[] {
  return [...RULE_FILES.map((name) => path.join(rulesDir(), name)), skillPath()];
}

export async function commandExists(name: string): Promise<boolean> {
  if (!/^[A-Za-z0-9._+-]+$/.test(name)) return false;
  try {
    await execA(`command -v ${name}`);
    return true;
  } catch {
    return false;
  }
}

export function npmGlobalPrefix(): string {
  try {
    return execSync("npm prefix -g", { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() || "(空)";
  } catch {
    return "(npm prefix -g 不可用)";
  }
}

export function readJsonObject(
  text: string,
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return { ok: false, error: "根节点不是对象" };
    }
    return { ok: true, value };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function dtcServerJsFrom(entry: unknown): string | undefined {
  if (!entry || typeof entry !== "object") return undefined;
  const args = (entry as { args?: unknown }).args;
  if (!Array.isArray(args)) return undefined;
  const strings = args.filter((a): a is string => typeof a === "string");
  return strings.find((a) => a.endsWith("server.js")) ?? strings[0];
}

/** 返回新配置，不改入参对象。其他 mcpServers 原样保留，只替换 dtc。 */
export function mergeDtcMcp(
  config: Record<string, unknown>,
  serverJs: string,
): { next: Record<string, unknown>; previous: unknown } {
  const servers = config.mcpServers;
  const serverMap =
    servers && typeof servers === "object" && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : {};
  const nextServers: Record<string, unknown> = {
    ...serverMap,
    dtc: { command: "node", args: [serverJs] },
  };
  return { next: { ...config, mcpServers: nextServers }, previous: serverMap.dtc };
}

export type McpPlan =
  | { ok: true; body: string; lines: string[] }
  | { ok: false; lines: string[] };

export function planMcpWrite(existingText: string | null, serverJs: string, fileLabel: string): McpPlan {
  const entry = { command: "node", args: [serverJs] };
  if (existingText === null) {
    const { next } = mergeDtcMcp({}, serverJs);
    return { ok: true, body: JSON.stringify(next, null, 2) + "\n", lines: [] };
  }
  const parsed = readJsonObject(existingText);
  if (!parsed.ok) {
    return {
      ok: false,
      lines: [`⚠️ ${fileLabel} 解析失败（${parsed.error}），未改写。请先修好 JSON。${RERUN_SETUP}`],
    };
  }
  const { next, previous } = mergeDtcMcp(parsed.value, serverJs);
  const lines: string[] = [];
  const oldJs = dtcServerJsFrom(previous);
  if (previous !== undefined && oldJs !== serverJs) {
    lines.push("ℹ️  mcpServers.dtc 已存在且路径不同，将覆盖：");
    lines.push(`   旧: ${JSON.stringify(previous)}`);
    lines.push(`   新: ${JSON.stringify(entry)}`);
  }
  return { ok: true, body: JSON.stringify(next, null, 2) + "\n", lines };
}

export function installedSkill(source: string, repoRoot: string): string {
  const abs = path.join(repoRoot, "skills/design-to-code/references") + "/";
  const nextLine = `references 源：\`${abs}\`（仓库内相对路径 \`skills/design-to-code/references/\`）。`;
  if (/^references 源：.*$/m.test(source)) return source.replace(/^references 源：.*$/m, nextLine);
  return `${nextLine}\n\n${source}`;
}

function copyRules(repoRoot: string): void {
  const srcDir = path.join(repoRoot, "integrations/cursor/rules-global");
  const dest = rulesDir();
  fs.mkdirSync(dest, { recursive: true });
  for (const name of RULE_FILES) {
    const from = path.join(srcDir, name);
    if (!fs.existsSync(from)) throw new Error(`缺少规则源 ${from}`);
    fs.copyFileSync(from, path.join(dest, name));
  }
}

function writeSkill(repoRoot: string): void {
  const src = path.join(repoRoot, "skills/design-to-code/SKILL.md");
  if (!fs.existsSync(src)) throw new Error(`缺少 skill 源 ${src}`);
  const body = installedSkill(fs.readFileSync(src, "utf8"), repoRoot);
  const dest = skillPath();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, body.endsWith("\n") ? body : `${body}\n`);
}

export function applyGlobalInstall(repoRoot: string): { mcpOk: boolean; lines: string[] } {
  const serverJs = serverJsPath(repoRoot);
  const file = mcpPath();
  const existing = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  const plan = planMcpWrite(existing, serverJs, file);
  const lines = [...plan.lines];
  if (plan.ok) {
    fs.mkdirSync(cursorDir(), { recursive: true });
    fs.writeFileSync(file, plan.body);
    lines.push(`✅ MCP: dtc server → ${file}`);
  }
  copyRules(repoRoot);
  lines.push(`✅ 全局规则: dtc-workflow.mdc + dtc-anti-fabrication.mdc → ${rulesDir()}`);
  writeSkill(repoRoot);
  lines.push(`✅ skill → ${skillPath()}`);
  lines.push("ℹ️  需重启 Cursor 生效（MCP 与规则在启动时加载）");
  return { mcpOk: plan.ok, lines };
}

/** 只拷 commands/*.md。不建 rules，不写 mcp。 */
export function copyProjectCommands(repoRoot: string, projectDir: string): string[] {
  const src = path.join(repoRoot, "integrations/cursor/commands");
  const dest = path.join(path.resolve(projectDir), ".cursor", "commands");
  fs.mkdirSync(dest, { recursive: true });
  const names = fs.readdirSync(src).filter((name) => name.endsWith(".md")).sort();
  for (const name of names) {
    fs.copyFileSync(path.join(src, name), path.join(dest, name));
  }
  return names;
}

export interface InstallCheck {
  ok: boolean;
  lines: string[];
}

export function checkMcpInstall(file: string = mcpPath()): InstallCheck {
  const fix = `   → ${RERUN_SETUP}`;
  if (!fs.existsSync(file)) {
    return { ok: false, lines: [`安装 · MCP: ❌ ${file} 不存在`, fix] };
  }
  const parsed = readJsonObject(fs.readFileSync(file, "utf8"));
  if (!parsed.ok) {
    return { ok: false, lines: [`安装 · MCP: ❌ ${file} 无法解析（${parsed.error}）`, fix] };
  }
  const servers = parsed.value.mcpServers;
  const serverMap =
    servers && typeof servers === "object" && !Array.isArray(servers)
      ? (servers as Record<string, unknown>)
      : {};
  const js = dtcServerJsFrom(serverMap.dtc);
  if (!js) {
    return { ok: false, lines: ["安装 · MCP: ❌ mcpServers.dtc.args 没有 server.js", fix] };
  }
  if (!fs.existsSync(js)) {
    return { ok: false, lines: [`安装 · MCP: ❌ server.js 不存在：${js}`, fix] };
  }
  return { ok: true, lines: [`安装 · MCP: ✅ ${js}`] };
}

export function checkRulesInstall(dir: string = rulesDir()): InstallCheck {
  const missing = RULE_FILES.filter((name) => !fs.existsSync(path.join(dir, name)));
  if (missing.length > 0) {
    return {
      ok: false,
      lines: [`安装 · 规则: ❌ 缺少 ${missing.join("、")}（${dir}）`, `   → ${RERUN_SETUP}`],
    };
  }
  return { ok: true, lines: [`安装 · 规则: ✅ ${RULE_FILES.join(" + ")}`] };
}
