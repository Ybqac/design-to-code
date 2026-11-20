import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import type { GroundTruth } from "@dtc/core";
import { runProvenance, scanCode } from "./check.js";

function groundTruth(
  spacing: Array<{ name: string; value: number; nodeId: string }>,
  rawIds: string[],
): GroundTruth {
  return {
    source: { via: "test", exported_at: "2020-01-01T00:00:00.000Z" },
    tokens: {
      colors: [],
      typography: [],
      spacing: spacing ?? [],
      radius: [],
    },
    raw_styles: rawIds.map((nodeId) => ({ nodeId, role: "other" as const, fills: [], strokes: [] })),
  };
}

it("间距不把宽高当作出处，隐藏节点不进覆盖率分母", () => {
  const snapshot = {
    id: "1:1",
    visible: true,
    itemSpacing: 8,
    absoluteBoundingBox: { width: 320, height: 40 },
    children: Array.from({ length: 10 }, (_, i) => ({ id: `9:${i}`, visible: false, itemSpacing: 99 })),
  };
  const { forged, coverageLow, nodeCount } = runProvenance(
    groundTruth(
      [
        { name: "spacing-8", value: 8, nodeId: "1:1" },
        { name: "spacing-320", value: 320, nodeId: "1:1" },
      ],
      ["1:1"],
    ),
    snapshot,
    false,
  );
  expect(nodeCount).toBe(1);
  expect(coverageLow).toBe(false);
  expect(forged.map((item) => item.value)).toEqual([320]);
});

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it("todo / 截图不把硬编码降级，占位图始终 UNMATCHED", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dtc-check-"));
  dirs.push(dir);
  fs.writeFileSync(
    path.join(dir, "a.css"),
    [
      ".todo { color: #ff00aa; } /* todo */",
      ".shot { font-size: 13px; } /* 截图 */",
      ".next { color: #abcdef; }",
      "/* 估读 */",
      ".est { color: #112233; } /* 估读 */",
      ".ph { background: url(https://picsum.photos/200); } /* 估读 */",
    ].join("\n"),
  );
  const gt: GroundTruth = {
    source: { via: "test", exported_at: "2020-01-01T00:00:00.000Z" },
    tokens: { colors: [], typography: [], spacing: [], radius: [] },
    raw_styles: [],
  };
  const results = scanCode(dir, gt);
  const level = (value: string) => results.find((item) => item.value === value)?.level;
  expect(level("#ff00aa")).toBe("UNMATCHED");
  expect(level("13px")).toBe("UNMATCHED");
  expect(level("#abcdef")).toBe("UNMATCHED");
  expect(level("#112233")).toBe("PENDING");
  expect(results.find((item) => item.kind === "占位图URL")?.level).toBe("UNMATCHED");
});
