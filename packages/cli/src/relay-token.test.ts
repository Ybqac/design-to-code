import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { injectRelayToken, RELAY_TOKEN_PLACEHOLDER } from "./relay-token.js";

const token = "ab".repeat(16);

it("占位符整段替换，源码里不留口令", () => {
  const out = injectRelayToken(`var RELAY_TOKEN = "${RELAY_TOKEN_PLACEHOLDER}";`, token);
  expect(out).toBe(`var RELAY_TOKEN = "${token}";`);
  expect(out.includes(RELAY_TOKEN_PLACEHOLDER)).toBe(false);
});

it("ui.html 和 overlay.js 只有占位符，没有 token 输入框", () => {
  const root = path.resolve(fileURLToPath(import.meta.url), "../../../..");
  for (const name of ["ui.html", "overlay.js"]) {
    const text = fs.readFileSync(path.join(root, "plugin/src", name), "utf8");
    expect(text.includes(RELAY_TOKEN_PLACEHOLDER)).toBe(true);
    expect(text.includes("token 框")).toBe(false);
    expect(text.includes('id="token"')).toBe(false);
    expect(text.includes('id="dtc-token"')).toBe(false);
  }
});
