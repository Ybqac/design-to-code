/**
 * 评分与收敛协议。
 *
 * Design Fidelity Score = 像素分 × 0.7 + 结构分 × 0.3（无结构校验时像素分即总分）。
 * 收敛协议（imugi 思路）：score ≥ threshold（默认 95）即收敛；连续 stallRounds 轮
 * （默认 3）无 0.5 分以上改进则判停滞停止，如实输出剩余差异。
 */
import type { StructureCheck, VerifyReport } from "./schema.js";

export interface ScoreInput {
  diffRatio: number; // pixelmatch 差异像素占比（0-1，已含阈值过滤）
  threshold: number; // pixelmatch 阈值（记录进报告，便于复现）
  structure?: StructureCheck;
}

export function pixelScore(diffRatio: number): number {
  return Math.round(Math.max(0, Math.min(100, 100 * (1 - diffRatio))) * 10) / 10;
}

export function fidelityScore(input: ScoreInput): number {
  const p = pixelScore(input.diffRatio);
  if (!input.structure) return p;
  const s = Math.max(0, Math.min(100, input.structure.score));
  return Math.round((p * 0.7 + s * 0.3) * 10) / 10;
}

export interface ConvergenceOptions {
  threshold: number; // 收敛分数线，默认 95
  minImprovement: number; // 判定"有改进"的最小分差，默认 0.5
  maxStalledRounds: number; // 停滞轮数上限，默认 3
  maxRounds: number; // 总轮数上限（安全阀），默认 10
}

export interface ConvergenceState {
  threshold: number;
  converged: boolean;
  previousScore: number | null;
  stalledRounds: number;
  stop: boolean;
  reason?: string;
}

export function evaluateConvergence(
  currentScore: number,
  previous: VerifyReport | undefined,
  opts: ConvergenceOptions,
  round: number,
): ConvergenceState {
  const threshold = opts.threshold ?? 95;
  const minImp = opts.minImprovement ?? 0.5;
  const maxStalled = opts.maxStalledRounds ?? 3;
  const maxRounds = opts.maxRounds ?? 10;

  const prevScore = previous?.fidelityScore ?? null;
  const prevStalled = previous?.convergence.stalledRounds ?? 0;

  if (currentScore >= threshold) {
    return {
      threshold,
      converged: true,
      previousScore: prevScore,
      stalledRounds: 0,
      stop: true,
      reason: `score ${currentScore} ≥ 阈值 ${threshold}`,
    };
  }
  if (round >= maxRounds) {
    return {
      threshold,
      converged: false,
      previousScore: prevScore,
      stalledRounds: prevStalled,
      stop: true,
      reason: `已达轮次上限 ${maxRounds}，当前 score ${currentScore}`,
    };
  }
  const improved = prevScore === null || currentScore - prevScore >= minImp;
  const stalledRounds = improved ? 0 : prevStalled + 1;
  if (stalledRounds >= maxStalled) {
    return {
      threshold,
      converged: false,
      previousScore: prevScore,
      stalledRounds,
      stop: true,
      reason: `连续 ${stalledRounds} 轮无 ≥${minImp} 分改进（${prevScore} → ${currentScore}），判停滞`,
    };
  }
  return { threshold, converged: false, previousScore: prevScore, stalledRounds, stop: false };
}

/**
 * 结构校验（Mimikyu 思路）：把 DOM 里每个文本节点的字号/颜色/内容与 ground-truth
 * 逐条比对，规避字体渲染像素底噪。输入由 cli/verify 采集。
 */
export interface TextObservation {
  content: string;
  fontSize?: number;
  color?: string; // rgb() 字符串
  fontWeight?: string;
  nodeId?: string; // DOM 侧无 nodeId 时靠内容匹配
}

export interface GtTextExpectation {
  nodeId: string;
  content: string;
  fontSize?: number;
  textColor?: string;
  fontWeight?: number | string;
}

function rgbToHex(rgb: string): string | undefined {
  const m = rgb?.match(/rgba?\((\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
  if (!m) return rgb?.toLowerCase();
  const hx = (n: string) => parseInt(n, 10).toString(16).padStart(2, "0");
  return `#${hx(m[1])}${hx(m[2])}${hx(m[3])}`;
}

function hexPrefix(color: string | undefined, len = 7): string | undefined {
  if (!color) return undefined;
  return color.toLowerCase().slice(0, len);
}

export function structureCheck(observed: TextObservation[], expected: GtTextExpectation[]): StructureCheck {
  const mismatches: StructureCheck["mismatches"] = [];
  let matched = 0;

  const usedObs = new Set<number>();
  for (const exp of expected) {
    // 内容匹配优先（DOM 侧无 nodeId 时），再按 nodeId
    let oi = observed.findIndex((o, i) => !usedObs.has(i) && o.nodeId === exp.nodeId);
    if (oi < 0) oi = observed.findIndex((o, i) => !usedObs.has(i) && o.content.trim() === exp.content.trim());
    if (oi < 0) {
      mismatches.push({
        kind: "missing-text",
        nodeId: exp.nodeId,
        expected: exp.content.slice(0, 40),
        detail: `ground-truth 文本未在渲染页找到`,
      });
      continue;
    }
    usedObs.add(oi);
    const obs = observed[oi];
    let ok = true;
    if (exp.fontSize && obs.fontSize && Math.abs(exp.fontSize - obs.fontSize) > 0.5) {
      mismatches.push({
        kind: "fontSize",
        nodeId: exp.nodeId,
        expected: `${exp.fontSize}px`,
        actual: `${obs.fontSize}px`,
        detail: obs.content.slice(0, 20),
      });
      ok = false;
    }
    if (exp.textColor && obs.color) {
      const e = hexPrefix(exp.textColor);
      const a = hexPrefix(rgbToHex(obs.color));
      if (e && a && e !== a) {
        mismatches.push({ kind: "color", nodeId: exp.nodeId, expected: exp.textColor, actual: rgbToHex(obs.color), detail: obs.content.slice(0, 20) });
        ok = false;
      }
    }
    if (ok) matched += 1;
  }

  const checked = expected.length;
  const score = checked === 0 ? 100 : Math.round((matched / checked) * 1000) / 10;
  return { score, textChecked: checked, textMatched: matched, mismatches };
}
