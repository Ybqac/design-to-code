/**
 * relay 共享口令。写在 ~/.dtc/relay.token，CLI 自动读。
 * 插件读不了家目录，由 dtc plugin build 把口令替换进构建产物，面板不手填。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const RELAY_HOST = "127.0.0.1";

/** 插件源码里的占位符。只出现在 plugin/src，构建时换成真实口令。 */
export const RELAY_TOKEN_PLACEHOLDER = "__DTC_RELAY_TOKEN__";

export function injectRelayToken(source: string, token: string): string {
  if (!source.includes(RELAY_TOKEN_PLACEHOLDER)) {
    throw new Error(`插件源码缺少 ${RELAY_TOKEN_PLACEHOLDER}`);
  }
  if (!/^[a-f0-9]{16,}$/i.test(token)) throw new Error("relay token 格式无效");
  return source.split(RELAY_TOKEN_PLACEHOLDER).join(token);
}

export function relayTokenPath(): string {
  return path.join(os.homedir(), ".dtc", "relay.token");
}

export function readRelayToken(): string | undefined {
  try {
    const token = fs.readFileSync(relayTokenPath(), "utf8").trim();
    return token || undefined;
  } catch {
    return undefined;
  }
}

/** 没有口令文件就生成。已有文件原样返回，不轮换。 */
export function ensureRelayToken(): string {
  const existing = readRelayToken();
  if (existing) return existing;
  const token = crypto.randomBytes(24).toString("hex");
  const file = relayTokenPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${token}\n`, { mode: 0o600 });
  return token;
}
