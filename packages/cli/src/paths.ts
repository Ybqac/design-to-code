/** .dtc/ 规格包目录约定 */
import fs from "node:fs";
import path from "node:path";

export interface DtcPaths {
  root: string; // .dtc/
  manifest: string;
  rawSnapshot: string;
  unifiedTree: string;
  groundTruth: string;
  spec: string;
  refDir: string;
  refImage: string;
  assetsDir: string;
  verifyDir: string;
}

export function dtcPaths(outDir = ".dtc"): DtcPaths {
  const root = path.resolve(outDir);
  return {
    root,
    manifest: path.join(root, "manifest.json"),
    rawSnapshot: path.join(root, "raw-node-snapshot.json"),
    unifiedTree: path.join(root, "unified-tree.json"),
    groundTruth: path.join(root, "design-ground-truth.json"),
    spec: path.join(root, "spec.json"),
    refDir: path.join(root, "ref"),
    refImage: path.join(root, "ref", "frame.png"),
    assetsDir: path.join(root, "assets"),
    verifyDir: path.join(root, "verify"),
  };
}

export function reportPath(verifyDir: string, round: number): string {
  return path.join(verifyDir, `report-${round}.json`);
}

/** 找下一个轮次号（.dtc/verify/report-N.json 已存在的最大 N + 1） */
export function nextRound(verifyDir: string): number {
  let max = 0;
  try {
    for (const f of fs.readdirSync(verifyDir)) {
      const m = f.match(/^report-(\d+)\.json$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  } catch {
    /* 目录不存在 */
  }
  return max + 1;
}
